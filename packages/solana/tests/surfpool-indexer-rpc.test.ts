import { createServer } from "node:http";
import { expect, it } from "vitest";
import { surfpoolIndexerRpc } from "./fixtures/surfpool-indexer-rpc.js";

it("preserves local transaction evidence and excludes discovery above the finalized slot", async () => {
  let invalidFinality = false;
  const old = {
    signature: "synthetic-old",
    slot: 9,
    err: null,
    blockTime: 100,
    confirmationStatus: "confirmed",
  };
  const future = { ...old, signature: "synthetic-future", slot: 11 };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input: Record<string, unknown> = JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: input.id,
        result:
          input.method === "getSlot"
            ? invalidFinality
              ? null
              : 10
            : input.method === "getSignaturesForAddress"
              ? [old, future]
              : input.params,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const binding = server.address();
  if (!binding || typeof binding === "string") throw new Error("Missing test port");
  const bridge = await surfpoolIndexerRpc(`http://127.0.0.1:${binding.port}`);
  async function rpc(method: string, params: unknown[]) {
    return fetch(bridge.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
    });
  }
  try {
    expect(
      await (
        await rpc("getSignaturesForAddress", ["synthetic", { commitment: "finalized" }])
      ).json(),
    ).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: [{ ...old, confirmationStatus: "finalized" }],
    });
    const exactBytes = ["synthetic-signed-wire-bytes", { encoding: "base64" }];
    expect((await (await rpc("sendTransaction", exactBytes)).json()).result).toEqual(
      exactBytes,
    );
    invalidFinality = true;
    expect(
      (await rpc("getSignaturesForAddress", ["synthetic", { commitment: "finalized" }]))
        .status,
    ).toBe(502);
  } finally {
    await bridge.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it("refuses an external upstream for the test-only compatibility bridge", async () => {
  await expect(surfpoolIndexerRpc("https://api.devnet.solana.com")).rejects.toThrow(
    "Local test RPC only",
  );
});
