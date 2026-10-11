import assert from "node:assert/strict";
import { test } from "node:test";
import {
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  partiallySignTransactionWithSigners,
  getTransactionDecoder,
  getBase64Encoder,
  getSignatureFromTransaction,
  type Transaction,
  type Address,
  type createSolanaRpc,
} from "@solana/kit";
import type { WalletState } from "@solana/kit-plugin-wallet";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import { createDevnetBootstrapClient } from "../lib/devnet-bootstrap.ts";

async function fixture() {
  const operator = await generateKeyPairSigner(),
    collection = await generateKeyPairSigner();
  const config = {
    cluster: "devnet",
    operator: operator.address,
    collection: collection.address,
    collectionUri: "https://katha.fun/test/collection.json",
    registrationAuthority: operator.address,
    verifierAuthority: operator.address,
    custodyAuthority: operator.address,
    treasury: operator.address,
    paymentMint: "So11111111111111111111111111111111111111112",
  };
  const loader = address("BPFLoaderUpgradeab1e11111111111111111111111");
  const [programData] = await getProgramDerivedAddress({
    programAddress: loader,
    seeds: [getAddressEncoder().encode(KATHA_REGISTRY_PROGRAM_ADDRESS)],
  });
  const programBytes = new Uint8Array(36),
    dataBytes = new Uint8Array(45);
  new DataView(programBytes.buffer).setUint32(0, 2, true);
  programBytes.set(getAddressEncoder().encode(programData), 4);
  new DataView(dataBytes.buffer).setUint32(0, 3, true);
  dataBytes[12] = 1;
  dataBytes.set(getAddressEncoder().encode(operator.address), 13);
  const controls = {
    genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    height: 1n,
    simulationError: false,
    mutate: false,
    invalidSignature: false,
    sendError: false,
    finalized: false,
    executionError: false,
    confirmedOnly: false,
    expireDuringApproval: false,
    signs: 0,
    sends: 0,
    retained: "",
  };
  const account = (data: Uint8Array, executable: boolean) => ({
    data: [Buffer.from(data).toString("base64"), "base64"],
    executable,
    owner: loader,
    lamports: 1_000_000n,
    rentEpoch: 0n,
    space: BigInt(data.length),
  });
  const rpc = {
    getGenesisHash: () => ({ send: async () => controls.genesis }),
    getAccountInfo: (key: Address) => ({
      send: async () => ({
        context: { slot: 1n },
        value:
          key === KATHA_REGISTRY_PROGRAM_ADDRESS
            ? account(programBytes, true)
            : key === programData
              ? account(dataBytes, false)
              : key === CORE_PROGRAM_ADDRESS
                ? account(new Uint8Array(36), true)
                : null,
      }),
    }),
    getLatestBlockhash: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: {
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 100n,
        },
      }),
    }),
    getFeeForMessage: () => ({
      send: async () => ({ context: { slot: 1n }, value: 5000n }),
    }),
    simulateTransaction: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: {
          err: controls.simulationError
            ? { InstructionError: [0, "InvalidArgument"] }
            : null,
          unitsConsumed: 100n,
        },
      }),
    }),
    getBlockHeight: () => ({ send: async () => controls.height }),
    sendTransaction: (wire: string) => ({
      send: async () => {
        controls.sends++;
        assert.ok(controls.retained, "retain signature before broadcasting");
        if (controls.sendError) throw new Error("synthetic network interruption");
        return getSignatureFromTransaction(
          getTransactionDecoder().decode(getBase64Encoder().encode(wire)),
        );
      },
    }),
    getSignatureStatuses: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: [
          controls.finalized || controls.confirmedOnly
            ? {
                err: controls.executionError
                  ? { InstructionError: [0, "InvalidArgument"] }
                  : null,
                confirmationStatus: controls.finalized ? "finalized" : "confirmed",
              }
            : null,
        ],
      }),
    }),
  } as unknown as ReturnType<typeof createSolanaRpc>;
  let state = {
    status: "connected",
    wallets: [],
    reconnectingTo: null,
    connected: {
      account: { address: operator.address },
      wallet: { name: "Synthetic wallet" },
      supportedTransactionVersions: new Set([0]),
      signer: {
        address: operator.address,
        modifyAndSignTransactions: async (transactions: Transaction[]) => {
          controls.signs++;
          if (controls.expireDuringApproval) controls.height = 101n;
          const signed = await partiallySignTransactionWithSigners(
            [operator],
            transactions[0]!,
          );
          if (controls.mutate)
            return [
              {
                ...signed,
                messageBytes: Uint8Array.from(signed.messageBytes, (b, i) =>
                  i === 0 ? b ^ 1 : b,
                ),
              },
            ];
          if (controls.invalidSignature)
            return [
              {
                ...signed,
                signatures: {
                  ...signed.signatures,
                  [operator.address]: new Uint8Array(64),
                },
              },
            ];
          return [signed];
        },
      },
    },
  } as unknown as WalletState;
  const client = createDevnetBootstrapClient({ getState: () => state }, undefined, rpc);
  const prepare = () => client.prepare("collection", config, undefined, collection);
  const retain = (value: string) => {
    controls.retained = value;
  };
  return {
    controls,
    client,
    prepare,
    retain,
    disconnect: () => {
      state = { ...state, status: "disconnected", connected: null };
    },
  };
}
test("preparation does not sign or send; explicit approval verifies both signatures and retains before broadcast", async () => {
  const f = await fixture(),
    prepared = await f.prepare();
  assert.equal(f.controls.signs, 0);
  assert.equal(f.controls.sends, 0);
  assert.equal(Object.keys(prepared.transaction.signatures).length, 2);
  const signature = await f.client.approve(prepared, f.retain);
  assert.equal(signature, f.controls.retained);
  assert.equal(f.controls.signs, 1);
  assert.equal(f.controls.sends, 1);
  assert.equal(await f.client.check(signature), "UNKNOWN");
  f.controls.finalized = true;
  assert.equal(await f.client.check(signature), "FINALIZED");
});
test("wrong genesis and failed simulation stop before requesting any wallet signature", async () => {
  for (const kind of ["genesis", "simulation"] as const) {
    const f = await fixture();
    if (kind === "genesis")
      f.controls.genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    else f.controls.simulationError = true;
    await assert.rejects(f.prepare());
    assert.equal(f.controls.signs, 0);
    assert.equal(f.controls.sends, 0);
  }
});
test("expired reviews, wallet disconnect and failed repeat simulation never reach signing", async () => {
  for (const kind of ["expiry", "wallet", "simulation"] as const) {
    const f = await fixture(),
      prepared = await f.prepare();
    if (kind === "expiry") f.controls.height = 101n;
    if (kind === "wallet") f.disconnect();
    if (kind === "simulation") f.controls.simulationError = true;
    await assert.rejects(f.client.approve(prepared, f.retain));
    assert.equal(f.controls.signs, 0);
    assert.equal(f.controls.sends, 0);
  }
});
test("wallet message mutation or invalid signatures cannot be broadcast", async () => {
  for (const kind of ["mutation", "signature"] as const) {
    const f = await fixture(),
      prepared = await f.prepare();
    f.controls.mutate = kind === "mutation";
    f.controls.invalidSignature = kind === "signature";
    await assert.rejects(f.client.approve(prepared, f.retain));
    assert.equal(f.controls.sends, 0);
    assert.equal(f.controls.retained, "");
  }
});
test("ambiguous broadcast retains the signature; repeated receipt checks never send replacements", async () => {
  const f = await fixture(),
    prepared = await f.prepare();
  f.controls.sendError = true;
  await assert.rejects(f.client.approve(prepared, f.retain));
  assert.ok(f.controls.retained);
  assert.equal(await f.client.check(f.controls.retained), "UNKNOWN");
  assert.equal(await f.client.check(f.controls.retained), "UNKNOWN");
  assert.equal(f.controls.signs, 1);
  assert.equal(f.controls.sends, 1);
});
test("confirmed errors stay unknown until finalized; approval-time expiry retains but does not broadcast", async () => {
  const f = await fixture(),
    prepared = await f.prepare();
  f.controls.expireDuringApproval = true;
  await assert.rejects(f.client.approve(prepared, f.retain));
  assert.ok(f.controls.retained);
  assert.equal(f.controls.sends, 0);
  f.controls.executionError = true;
  f.controls.confirmedOnly = true;
  assert.equal(await f.client.check(f.controls.retained), "UNKNOWN");
  f.controls.finalized = true;
  assert.equal(await f.client.check(f.controls.retained), "FAILED");
});
