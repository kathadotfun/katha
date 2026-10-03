import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each([
  { DATABASE_URL: "SYNTHETIC_DATABASE_SECRET" },
  {
    DATABASE_URL: "postgres://synthetic:fixture-password@127.0.0.1/katha_test",
    KATHA_CLUSTER: "mainnet-beta",
  },
])("fails before listening when startup configuration is invalid", (settings) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, NODE_ENV: "test", ...settings },
    encoding: "utf8",
    timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("Invalid API configuration");
  expect(result.stderr).not.toContain("SYNTHETIC_DATABASE_SECRET");
  expect(result.stderr).not.toContain("fixture-password");
  expect(result.stderr).not.toContain("at readServerConfiguration");
});

it("starts on the configured listener and closes on SIGTERM", async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Expected test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      KATHA_CLUSTER: "localnet",
      DATABASE_URL: "postgres://synthetic:fixture-password@127.0.0.1/katha_test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("API startup timed out")), 3000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes(`listening on port ${port}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("API exited before startup"));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1000),
    });
    expect(response.status).toBe(404);
    await response.text();
    child.kill("SIGTERM");
    expect((await exited)[0]).toBe(0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}, 10_000);
