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

it("limits faults to selected local reads, preserves wire submissions and restores original responses", async () => {
  const row = { owner: "SyntheticProgram", data: ["AQID", "base64"], lamports: 42 };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as {
      id: number;
      method: string;
      params: unknown[];
    };
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: input.id,
        result:
          input.method === "getMultipleAccounts"
            ? { value: [row, row] }
            : input.method === "getAccountInfo"
              ? { value: row }
              : input.params,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const binding = server.address();
  if (!binding || typeof binding === "string") throw new Error("Missing test port");
  const bridge = await surfpoolIndexerRpc(`http://127.0.0.1:${binding.port}`);
  async function call(method: string, params: unknown[]) {
    return fetch(bridge.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  }
  try {
    bridge.setFault({ kind: "ACCOUNT_OWNER", address: "target" });
    const bad = await (await call("getMultipleAccounts", [["other", "target"]])).json();
    expect(bad.result.value[0]).toEqual(row);
    expect(bad.result.value[1].owner).toBe("11111111111111111111111111111111");
    bridge.setFault({ kind: "ACCOUNT_DATA", address: "target", data: "BAUG" });
    expect(
      (await (await call("getAccountInfo", ["target"])).json()).result.value.data,
    ).toEqual(["BAUG", "base64"]);
    const wire = ["exact-signed-bytes", { encoding: "base64" }];
    expect((await (await call("sendTransaction", wire)).json()).result).toEqual(wire);
    bridge.setFault({ kind: "UNAVAILABLE" });
    const outage = await call("getSlot", []);
    expect(outage.status).toBe(502);
    expect(await outage.text()).toBe("");
    bridge.setFault(null);
    expect(
      (await (await call("getAccountInfo", ["target"])).json()).result.value,
    ).toEqual(row);
  } finally {
    await bridge.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
