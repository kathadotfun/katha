import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createDatabase, validateDatabaseUrl } from "@katha/db";
import { expect, it } from "vitest";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createReadiness } from "../src/readiness.js";

it("reports actual PostgreSQL availability then becomes unavailable after pool closure", async () => {
  // Only the owned disposable container runner supplies this target; never load .env.
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable database target");
  const database = createDatabase(url);
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    createReadiness(database.check),
  );
  try {
    const ready = await app.request("/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    await database.close();
    expect((await app.request("/health/ready")).status).toBe(503);
    expect((await app.request("/health/live")).status).toBe(200);
    expect(logs.join("")).not.toContain(target.password);
    expect(logs.join("")).not.toContain(url);
  } finally {
    await database.close();
  }
});

it("closes an opened PostgreSQL pool when the running API receives SIGTERM", async () => {
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable database target");
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
      DATABASE_URL: url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  const logs: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("API startup timed out")), 3000);
      child.stdout.on("data", (chunk: Buffer) => {
        const line = chunk.toString();
        logs.push(line);
        if (line.includes(`"port":${port}`)) {
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
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`, {
      signal: AbortSignal.timeout(3000),
    });
    expect(ready.status).toBe(200);
    await ready.text();
    child.kill("SIGTERM");
    expect((await exited)[0]).toBe(0);
    expect(logs.join("")).toContain('"event":"server_stopping"');
    expect(logs.join("")).not.toContain(target.password);
    expect(logs.join("")).not.toContain(url);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}, 8000);
