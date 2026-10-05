import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { expect, it } from "vitest";
function child(environment: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const processChild = spawn(
        process.execPath,
        ["--import", "tsx", "src/indexer-inspect.ts"],
        {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          env: { ...process.env, ...environment },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10000,
        },
      );
      let stdout = "",
        stderr = "";
      processChild.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      processChild.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      processChild.once("error", reject);
      processChild.once("exit", (code) => resolve({ code, stdout, stderr }));
    },
  );
}
it("rejects invalid inspector configuration without logging private values", async () => {
  const result = await child({ DATABASE_URL: "SYNTHETIC_PRIVATE_CONFIG" });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("SYNTHETIC_PRIVATE_CONFIG");
  expect(JSON.parse(result.stderr)).toMatchObject({ event: "configuration_invalid" });
});
it("inspects both streams without opening the unavailable database", async () => {
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      id: string;
      method: string;
      params: unknown[];
    };
    methods.push(body.method);
    const result =
      body.method === "getGenesisHash" ? "11111111111111111111111111111111" : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const info = server.address();
    if (!info || typeof info === "string") throw new Error("Expected listener");
    const result = await child({
      DATABASE_URL: "postgres://synthetic:fixture-password@127.0.0.1:1/katha_test",
      KATHA_CLUSTER: "localnet",
      KATHA_RPC_URL: `http://127.0.0.1:${info.port}`,
      KATHA_RPC_SUBSCRIPTIONS_URL: `ws://127.0.0.1:${info.port}`,
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    for (const line of lines)
      expect(line).toMatchObject({
        event: "activity_page_observed",
        cluster: "localnet",
        transactions: 0,
        activities: 0,
      });
    expect(methods).toEqual([
      "getGenesisHash",
      "getSignaturesForAddress",
      "getGenesisHash",
      "getSignaturesForAddress",
    ]);
    expect(result.stdout).not.toContain("fixture-password");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
