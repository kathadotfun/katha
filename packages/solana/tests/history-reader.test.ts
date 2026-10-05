import { expect, it, vi } from "vitest";
import {
  address,
  SolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Rpc,
  type GetGenesisHashApi,
  type GetFirstAvailableBlockApi,
  type GetSlotApi,
  type GetAccountInfoApi,
} from "@solana/kit";
import { Key } from "@metaplex-foundation/mpl-core";
import { getAssetV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js";
import { publicKey } from "@metaplex-foundation/umi";
import { createHistoryReaderFromRpc } from "../src/history-reader.js";
import { isRetryableRpcFailure } from "../src/rpc-retry.js";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
const collection = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  asset = address("Vote111111111111111111111111111111111111111"),
  owner = address("11111111111111111111111111111111");
function setup() {
  const bytes = getAssetV1AccountDataSerializer().serialize({
    key: Key.AssetV1,
    owner: publicKey(owner),
    updateAuthority: { __kind: "Collection", fields: [publicKey(collection)] },
    name: "Synthetic",
    uri: "https://katha.fun/synthetic",
    seq: null,
  });
  const genesis = vi.fn().mockResolvedValue(owner),
    first = vi.fn().mockResolvedValue(0n),
    slot = vi.fn().mockResolvedValue(20n);
  const response = {
    context: { slot: 20n },
    value: {
      data: [Buffer.from(bytes).toString("base64"), "base64"],
      owner: CORE_PROGRAM_ADDRESS as string,
      executable: false,
      lamports: 100n,
      space: BigInt(bytes.length),
    },
  };
  const account = vi.fn().mockResolvedValue(response);
  const rpc = {
    getGenesisHash: vi.fn(() => ({ send: genesis })),
    getFirstAvailableBlock: vi.fn(() => ({ send: first })),
    getSlot: vi.fn(() => ({ send: slot })),
    getAccountInfo: vi.fn(() => ({ send: account })),
  } as unknown as Rpc<
    GetGenesisHashApi & GetFirstAvailableBlockApi & GetSlotApi & GetAccountInfoApi
  >;
  return {
    response,
    genesis,
    first,
    slot,
    account,
    rpc,
    read: createHistoryReaderFromRpc(rpc, "localnet"),
  };
}
it("reads a validated genesis, ledger floor and finalized slot", async () => {
  const options = setup();
  expect(await options.read.snapshot()).toEqual({
    genesisHash: owner,
    firstAvailableBlock: 0n,
    finalizedSlot: 20n,
  });
  expect(options.rpc.getSlot).toHaveBeenCalledWith({ commitment: "finalized" });
  options.first.mockResolvedValue(21n);
  await expect(options.read.snapshot()).rejects.toThrow();
});
it("reads validated Core ownership at a bounded finalized context", async () => {
  const options = setup();
  expect(await options.read.owner(asset, collection, 20n)).toEqual({
    slot: 20n,
    owner,
    status: "PRESENT",
  });
  expect(options.rpc.getAccountInfo).toHaveBeenCalledWith(asset, {
    commitment: "finalized",
    encoding: "base64",
    minContextSlot: 20n,
  });
});
it.each(["program", "collection", "space", "executable", "data"])(
  "records invalid %s evidence without an owner claim",
  async (kind) => {
    const options = setup();
    if (kind === "program") options.response.value.owner = owner;
    if (kind === "space") options.response.value.space = 1n;
    if (kind === "executable") options.response.value.executable = true;
    if (kind === "data") options.response.value.data[0] = "AAAA";
    expect(
      await options.read.owner(asset, kind === "collection" ? owner : collection, 20n),
    ).toEqual({ slot: 20n, owner: null, status: "INVALID" });
  },
);
it("records missing accounts and rejects stale contexts or wrong clusters", async () => {
  const options = setup();
  options.account.mockResolvedValueOnce({ context: { slot: 20n }, value: null });
  expect(await options.read.owner(asset, collection, 20n)).toEqual({
    slot: 20n,
    owner: null,
    status: "MISSING",
  });
  options.response.context.slot = 19n;
  await expect(options.read.owner(asset, collection, 20n)).rejects.toThrow();
  options.genesis.mockResolvedValue("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  await expect(options.read.snapshot()).rejects.toThrow("cluster");
});
it.each([429, 500, 503, 400, 401, 403])(
  "classifies HTTP %s without retrying authorization/configuration failures",
  (statusCode) => {
    const error = new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
      headers: new Headers(),
      message: "Synthetic",
      statusCode,
    });
    expect(isRetryableRpcFailure(error)).toBe(statusCode === 429 || statusCode >= 500);
  },
);
it("classifies bounded network/timeouts while rejecting arbitrary evidence errors", () => {
  expect(
    isRetryableRpcFailure(new TypeError("fetch", { cause: { code: "ECONNRESET" } })),
  ).toBe(true);
  expect(isRetryableRpcFailure(new DOMException("timeout", "TimeoutError"))).toBe(true);
  expect(isRetryableRpcFailure(new Error("Synthetic invalid evidence"))).toBe(false);
});

it("validates finalized context and Core bytes through real Kit loopback transport", async () => {
  const { createServer } = await import("node:http");
  const { createHistoryReader } = await import("../src/history-reader.js");
  const fixture = setup();
  const methods: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString()) as {
      id: number;
      method: string;
    };
    methods.push(request.method);
    const result =
      request.method === "getGenesisHash"
        ? owner
        : request.method === "getFirstAvailableBlock"
          ? 0
          : request.method === "getSlot"
            ? 20
            : fixture.response;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }, (_, value: unknown) =>
        typeof value === "bigint" ? Number(value) : value,
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const endpoint = server.address();
    if (!endpoint || typeof endpoint === "string") throw new Error("No test endpoint");
    const read = createHistoryReader({
      cluster: "localnet",
      rpcUrl: `http://127.0.0.1:${endpoint.port}`,
      rpcSubscriptionsUrl: `ws://127.0.0.1:${endpoint.port}`,
    });
    expect(await read.snapshot()).toMatchObject({
      firstAvailableBlock: 0n,
      finalizedSlot: 20n,
    });
    expect(await read.owner(asset, collection, 20n)).toEqual({
      slot: 20n,
      owner,
      status: "PRESENT",
    });
    expect(methods).toEqual([
      "getGenesisHash",
      "getFirstAvailableBlock",
      "getSlot",
      "getGenesisHash",
      "getAccountInfo",
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
