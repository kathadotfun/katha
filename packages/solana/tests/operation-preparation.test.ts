import { expect, it, vi } from "vitest";
import {
  AccountRole,
  address,
  blockhash,
  type GetLatestBlockhashApi,
  type GetBlockHeightApi,
  type SimulateTransactionApi,
  type Rpc,
} from "@solana/kit";
import { unsignedMessage } from "../src/registration.js";
import {
  createOperationChainFromRpc,
  encodeUnsignedRegistryTransaction,
} from "../src/operation-preparation.js";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "../src/generated/registry/index.js";

function fixture(cluster: "localnet" | "devnet" = "localnet") {
  const simulate = vi.fn(async () => ({
    context: { slot: 10n },
    value: { err: null, unitsConsumed: 50n },
  }));
  const latest = vi.fn(async () => ({
    context: { slot: 9n },
    value: {
      blockhash: blockhash("11111111111111111111111111111111"),
      lastValidBlockHeight: 100n,
    },
  }));
  const height = vi.fn(async () => 50n);
  const simulateTransaction = vi.fn(() => ({ send: simulate }));
  const rpc = {
    getLatestBlockhash: () => ({ send: latest }),
    getBlockHeight: () => ({ send: height }),
    simulateTransaction,
  };
  const chain = createOperationChainFromRpc(
    rpc as unknown as Rpc<
      GetLatestBlockhashApi & GetBlockHeightApi & SimulateTransactionApi
    >,
    cluster,
  );
  const wallet = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const prepared = async () =>
    unsignedMessage(await chain.context(wallet, new Set([0, 1])), {
      programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
      accounts: [{ address: wallet, role: AccountRole.WRITABLE_SIGNER }],
      data: new Uint8Array([1]),
    });
  return { chain, prepared, simulate, latest, height, simulateTransaction, wallet };
}
it.each(["localnet", "devnet"] as const)(
  "encodes an unsigned %s message and simulates its exact lifetime",
  async (cluster) => {
    const f = fixture(cluster);
    const prepared = await f.prepared();
    const encoded = await encodeUnsignedRegistryTransaction(prepared);
    expect(encoded.requiredSignerAddresses).toEqual([f.wallet]);
    expect(encoded.transactionVersion).toBe(cluster === "devnet" ? 1 : 0);
    expect(encoded.messageHash).toMatch(/^[0-9a-f]{64}$/);
    const result = await f.chain.simulate(prepared);
    expect(result.transactionBase64).toBe(encoded.transactionBase64);
    expect(result.simulation).toEqual({ slot: "10", unitsConsumed: "50" });
    expect(f.simulateTransaction).toHaveBeenCalledWith(encoded.transactionBase64, {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
  },
);
it("rejects a failed program simulation without returning RPC logs", async () => {
  const f = fixture();
  const prepared = await f.prepared();
  f.simulate.mockResolvedValueOnce({
    context: { slot: 10n },
    value: { err: { private: "untrusted log" }, unitsConsumed: 50n },
  } as never);
  await expect(f.chain.simulate(prepared)).rejects.toMatchObject({
    code: "REJECTED",
    message: "Operation simulation could not complete",
  });
});
it.each(["network", "missing-error", "negative-slot", "invalid-units"])(
  "rejects %s simulation responses",
  async (reason) => {
    const f = fixture();
    const prepared = await f.prepared();
    if (reason === "network")
      f.simulate.mockRejectedValueOnce(new Error("private network detail"));
    else
      f.simulate.mockResolvedValueOnce({
        context: { slot: reason === "negative-slot" ? -1n : 10n },
        value: {
          err: reason === "missing-error" ? undefined : null,
          unitsConsumed: reason === "invalid-units" ? 1 : 50n,
        },
      } as never);
    await expect(f.chain.simulate(prepared)).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  },
);
it("rejects a lifetime that expires while simulating", async () => {
  const f = fixture();
  const prepared = await f.prepared();
  f.height.mockResolvedValueOnce(100n);
  await expect(f.chain.simulate(prepared)).rejects.toMatchObject({ code: "REJECTED" });
});
it("fails closed if the post-simulation height read fails", async () => {
  const f = fixture();
  const prepared = await f.prepared();
  f.height.mockRejectedValueOnce(new Error("RPC offline"));
  await expect(f.chain.simulate(prepared)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
});
it("rejects expired blockhash context and unsupported wallet versions", async () => {
  const f = fixture();
  f.height.mockResolvedValueOnce(100n);
  await expect(f.prepared()).rejects.toThrow("Expired blockhash");
  await expect(f.chain.context(f.wallet, new Set(["legacy"]))).rejects.toThrow(
    "supported",
  );
});
it("retains no key or signing implementation in serialized preparation", async () => {
  const f = fixture();
  const encoded = await encodeUnsignedRegistryTransaction(await f.prepared());
  expect(Object.keys(encoded).sort()).toEqual([
    "blockhash",
    "feePayer",
    "lastValidBlockHeight",
    "messageHash",
    "requiredSignerAddresses",
    "transactionBase64",
    "transactionVersion",
  ]);
});
it("rejects additional compiled signers before calling RPC", async () => {
  const f = fixture();
  const context = await f.chain.context(f.wallet, new Set([0]));
  const prepared = unsignedMessage(context, {
    programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
    accounts: [
      { address: f.wallet, role: AccountRole.WRITABLE_SIGNER },
      {
        address: address("Vote111111111111111111111111111111111111111"),
        role: AccountRole.READONLY_SIGNER,
      },
    ],
    data: new Uint8Array([1]),
  });
  await expect(f.chain.simulate(prepared)).rejects.toMatchObject({ code: "REJECTED" });
  expect(f.simulateTransaction).not.toHaveBeenCalled();
});
it("rejects oversized v0 transactions before RPC", async () => {
  const f = fixture();
  const context = await f.chain.context(f.wallet, new Set([0]));
  await expect(async () => {
    const prepared = unsignedMessage(context, {
      programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
      accounts: [{ address: f.wallet, role: AccountRole.WRITABLE_SIGNER }],
      data: new Uint8Array(1300),
    });
    await f.chain.simulate(prepared);
  }).rejects.toThrow();
  expect(f.simulateTransaction).not.toHaveBeenCalled();
});
