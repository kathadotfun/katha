import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateKeyPairSigner,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  blockhash,
  signTransaction,
  getSignatureFromTransaction,
  pipe,
} from "@solana/kit";
import { sha256Hex, type UnsignedOperationResponse } from "@katha/shared";
import {
  getRegisterArtworkInstructionAsync,
  ArtworkCategory,
} from "@katha/solana/registry";
import {
  inspectPreparedTransaction,
  validateSignedTransaction,
} from "../lib/prepared-transaction.ts";
import { createTransactionLifecycle } from "../lib/transaction-lifecycle.ts";
import { createWalletBoundary } from "../lib/wallet-connection.ts";
import { publicTransactionRpcUrl } from "../lib/transaction-rpc.ts";
import type {
  WalletConnection,
  WalletConnectionSnapshot,
} from "../lib/wallet-connection.ts";
import type { WalletSessionController } from "../lib/wallet-session.ts";
import type { WalletState } from "@solana/kit-plugin-wallet";
import { provenanceFixture } from "./fixtures/provenance.ts";

async function fixture(version: 0 | 1 = 0) {
  const signer = await generateKeyPairSigner();
  const kathaId = "KATHA-PAUBHA-000001";
  const id = "aaaaaaaa-1111-4111-8111-111111111111";
  const ix = await getRegisterArtworkInstructionAsync({
    registrationAuthority: signer,
    kathaId,
    artistId: id,
    creatorWallet: null,
    category: ArtworkCategory.Paubha,
    creationYear: 2026,
    authorshipEvidenceHash: new Uint8Array(32),
  });
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version }),
      (msg) => setTransactionMessageFeePayer(signer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: 100n,
          },
          msg,
        ),
      (msg) => appendTransactionMessageInstruction(ix, msg),
    ),
  );
  const signed = await signTransaction([signer.keyPair], transaction);
  const wire = String(getBase64EncodedWireTransaction(signed));
  const signature = getSignatureFromTransaction(signed);
  const operation: UnsignedOperationResponse = {
    operationId: id,
    preparationId: "bbbbbbbb-1111-4111-8111-111111111111",
    kathaId,
    kind: "REGISTER_ARTWORK",
    cluster: version === 0 ? "localnet" : "devnet",
    status: "PREPARED",
    requestHash: "a".repeat(64),
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
    transactionVersion: version,
    feePayer: signer.address,
    requiredSignerAddresses: [signer.address],
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: "100",
    simulation: { slot: "1", unitsConsumed: "200" },
  };
  let wallet: WalletConnectionSnapshot = {
    status: "connected",
    wallets: [],
    connected: {
      walletId: "wallet-1",
      walletName: "Test",
      address: signer.address,
      accounts: [signer.address],
      supportsMessageSigning: true,
      supportsV0: true,
      supportsV1: version === 1,
    },
  };
  const walletListeners = new Set<() => void>(),
    sessionListeners = new Set<() => void>();
  const calls: string[] = [];
  const connection: WalletConnection = {
    cluster: operation.cluster,
    getSnapshot: () => wallet,
    subscribe: (fn) => {
      walletListeners.add(fn);
      return () => {
        walletListeners.delete(fn);
      };
    },
    connect: async () => {},
    disconnect: async () => {},
    selectAccount: () => {},
    dispose: () => {},
    signLoginChallenge: async () => "",
    signPreparedTransaction: async () => {
      calls.push("sign");
      return wire;
    },
  };
  const auth = {
    walletId: id,
    walletAddress: signer.address,
    cluster: operation.cluster,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  let observed: "UNKNOWN" | "FAILED" | "FINALIZED" = "UNKNOWN";
  const session: WalletSessionController = {
    readArtworkMedia: async () => {
      throw new Error("Unused");
    },
    uploadArtworkMedia: async () => {
      throw new Error("Unused");
    },
    updateArtworkMedia: async () => {
      throw new Error("Unused");
    },
    readArtworkDraft: async () => {
      throw new Error("Unused");
    },
    createArtworkDraft: async () => {
      throw new Error("Unused");
    },
    updateArtworkDraft: async () => {
      throw new Error("Unused");
    },
    listArtworkDrafts: async () => {
      throw new Error("Unused fixture method");
    },
    permissions: async () => {
      throw new Error("Unused fixture method");
    },
    createArtist: async () => {
      throw new Error("Unused fixture method");
    },
    readArtist: async () => {
      throw new Error("Unused fixture method");
    },
    verifyArtist: async () => {
      throw new Error("Unused fixture method");
    },
    getSnapshot: () => ({ status: "signed-in", session: auth, error: null }),
    subscribe: (fn) => {
      sessionListeners.add(fn);
      return () => {
        sessionListeners.delete(fn);
      };
    },
    signIn: async () => {},
    signOut: () => {},
    dispose: () => {},
    reconcile: async () => {
      calls.push("receipt");
      return {
        receiptId: id,
        operationId: id,
        preparationId: operation.preparationId,
        kind: operation.kind,
        cluster: operation.cluster,
        signature,
        messageHash: operation.messageHash,
        status: observed,
        operationStatus: observed,
        failureCode: observed === "FAILED" ? "TRANSACTION_FAILED" : null,
        slot: observed === "FINALIZED" ? "12" : null,
        chainRecordedAt: observed === "FINALIZED" ? new Date().toISOString() : null,
      };
    },
  };
  const rpc = {
    height: async () => 1n,
    simulate: async () => {
      calls.push("simulate");
      return { slot: "2", unitsConsumed: "220", feeLamports: "5000" };
    },
    submit: async () => {
      calls.push("submit");
    },
  };
  let indexed = false;
  const history = async () => ({
    ...provenanceFixture,
    chain: {
      ...provenanceFixture.chain,
      cluster:
        operation.cluster === "devnet" ? ("DEVNET" as const) : ("LOCALNET" as const),
    },
    items: indexed
      ? [
          {
            ...provenanceFixture.items[0]!,
            transaction: { ...provenanceFixture.items[0]!.transaction, signature },
          },
        ]
      : [],
  });
  const flow = createTransactionLifecycle(connection, session, rpc, history);
  return {
    signer,
    operation,
    wire,
    signature,
    signed,
    transaction,
    flow,
    connection,
    session,
    rpc,
    calls,
    walletListeners,
    sessionListeners,
    setIndexed: () => {
      indexed = true;
    },
    setStatus: (value: typeof observed) => {
      observed = value;
    },
    switchWallet: () => {
      wallet = { ...wallet, connected: null, status: "disconnected" };
      for (const fn of walletListeners) fn();
    },
  };
}
test("canonical preparation validates signer, cluster, version, kind, hash and exact signature bytes", async () => {
  for (const version of [0, 1] as const) {
    const f = await fixture(version);
    await inspectPreparedTransaction(f.operation, {
      wallet: f.signer.address,
      cluster: f.operation.cluster,
      kind: f.operation.kind,
      kathaId: f.operation.kathaId,
    });
    assert.equal(await validateSignedTransaction(f.wire, f.operation), f.signature);
    for (const patch of [
      { messageHash: "0".repeat(64) },
      { kathaId: "KATHA-PAUBHA-000002" },
      { feePayer: "11111111111111111111111111111111" },
      { transactionVersion: version === 0 ? 1 : 0 },
      { kind: "VERIFY_ARTWORK" },
      { blockhash: "11111111111111111111111111111112" },
      { transactionBase64: f.wire },
    ])
      await assert.rejects(
        inspectPreparedTransaction(
          { ...f.operation, ...patch },
          {
            wallet: f.signer.address,
            cluster: f.operation.cluster,
            kind: f.operation.kind,
            kathaId: f.operation.kathaId,
          },
        ),
      );
    await assert.rejects(
      validateSignedTransaction(f.operation.transactionBase64, f.operation),
    );
    const tampered = {
      ...f.signed,
      messageBytes: Uint8Array.from(f.signed.messageBytes, (byte, index) =>
        index === f.signed.messageBytes.length - 1 ? byte ^ 1 : byte,
      ) as unknown as typeof f.signed.messageBytes,
    };
    await assert.rejects(
      validateSignedTransaction(
        String(getBase64EncodedWireTransaction(tampered)),
        f.operation,
      ),
    );
    f.flow.dispose();
  }
});
test("explicit approval records before single submission; unknown outcomes only reconcile and do not re-sign", async () => {
  const f = await fixture();
  await f.flow.load(f.operation, f.operation);
  assert.equal(f.flow.getSnapshot().phase, "review");
  assert.ok(!f.calls.includes("sign"));
  await Promise.all([f.flow.approveAndSend(), f.flow.approveAndSend()]);
  assert.equal(f.flow.getSnapshot().phase, "unknown");
  assert.ok(f.calls.indexOf("receipt") < f.calls.indexOf("submit"));
  await f.flow.approveAndSend();
  await f.flow.checkConfirmation();
  assert.equal(f.calls.filter((call) => call === "submit").length, 1);
  assert.equal(f.calls.filter((call) => call === "sign").length, 1);
  f.setStatus("FINALIZED");
  await f.flow.checkConfirmation();
  assert.equal(f.flow.getSnapshot().phase, "indexing-delay");
  f.setStatus("UNKNOWN");
  await f.flow.checkConfirmation();
  assert.equal(f.flow.getSnapshot().phase, "indexing-delay");
  f.setStatus("FINALIZED");
  f.setIndexed();
  await f.flow.checkConfirmation();
  assert.equal(f.flow.getSnapshot().phase, "indexed");
  f.flow.dispose();
});
test("rejection, failed simulation, unsupported version, fee change and lifetime expiry never submit", async () => {
  for (const reason of ["reject", "simulation", "unsupported", "fee", "expiry"]) {
    const f = await fixture();
    if (reason === "simulation")
      f.rpc.simulate = async () => {
        throw new Error("PRIVATE_RPC_ERROR");
      };
    if (reason === "expiry") f.rpc.height = async () => 100n;
    // Use a separate stored snapshot to avoid recursive fixture access.
    if (reason === "unsupported") {
      const snap = {
        status: "connected" as const,
        wallets: [],
        connected: {
          walletId: "wallet-1",
          walletName: "Test",
          address: f.signer.address,
          accounts: [f.signer.address],
          supportsV0: false,
          supportsV1: false,
          supportsMessageSigning: true,
        },
      };
      f.connection.getSnapshot = () => snap;
    }
    await f.flow.load(f.operation, f.operation);
    if (reason === "reject")
      f.connection.signPreparedTransaction = async () => {
        throw new Error("PRIVATE_WALLET_REJECTION");
      };
    if (reason === "fee")
      f.rpc.simulate = async () => ({
        slot: "2",
        unitsConsumed: "2",
        feeLamports: "6000",
      });
    await f.flow.approveAndSend();
    assert.ok(!f.calls.includes("submit"));
    assert.ok(!f.flow.getSnapshot().error?.includes("PRIVATE"));
    f.flow.dispose();
  }
});
test("send timeout keeps known signature; expired after approval and retention failure never broadcast", async () => {
  for (const reason of ["timeout", "expired", "retain"]) {
    const f = await fixture();
    await f.flow.load(f.operation, f.operation);
    if (reason === "timeout")
      f.rpc.submit = async () => {
        f.calls.push("submit");
        throw new Error("Timeout");
      };
    if (reason === "expired")
      f.connection.signPreparedTransaction = async () => {
        f.rpc.height = async () => 100n;
        return f.wire;
      };
    if (reason === "retain")
      f.session.reconcile = async () => {
        throw new Error("Unavailable");
      };
    await f.flow.approveAndSend();
    assert.equal(f.flow.getSnapshot().signature, f.signature);
    assert.equal(
      f.calls.filter((call) => call === "submit").length,
      reason === "timeout" ? 1 : 0,
    );
    assert.ok(["unknown", "expired"].includes(f.flow.getSnapshot().phase));
    f.flow.dispose();
  }
});
test("account changes during simulation or wallet approval clear state and discard late work", async () => {
  for (const phase of ["simulation", "signing"]) {
    const f = await fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (phase === "simulation")
      f.rpc.simulate = async () => {
        await pending;
        return { slot: "1", unitsConsumed: "1", feeLamports: "5000" };
      };
    else {
      await f.flow.load(f.operation, f.operation);
      f.connection.signPreparedTransaction = async () => {
        await pending;
        return f.wire;
      };
    }
    const work =
      phase === "simulation"
        ? f.flow.load(f.operation, f.operation)
        : f.flow.approveAndSend();
    await new Promise((resolve) => setImmediate(resolve));
    f.switchWallet();
    release();
    await work;
    assert.equal(f.flow.getSnapshot().phase, "idle");
    assert.ok(!f.calls.includes("submit"));
    f.flow.dispose();
    assert.equal(f.walletListeners.size, 0);
    assert.equal(f.sessionListeners.size, 0);
  }
});
test("only finalized execution failure becomes failed, and receipt mismatches never report success", async () => {
  const f = await fixture();
  await f.flow.load(f.operation, f.operation);
  await f.flow.approveAndSend();
  f.setStatus("FAILED");
  await f.flow.checkConfirmation();
  assert.equal(f.flow.getSnapshot().phase, "failed");
  f.flow.dispose();
  const g = await fixture();
  await g.flow.load(g.operation, g.operation);
  const reconcile = g.session.reconcile;
  g.session.reconcile = async (...args) => ({
    ...(await reconcile(...args)),
    signature: "1".repeat(88),
  });
  await g.flow.approveAndSend();
  assert.equal(g.flow.getSnapshot().phase, "unknown");
  assert.ok(!g.calls.includes("submit"));
  g.flow.dispose();
});
test("wallet adapter uses separate signing and rejects wallet byte modifications", async () => {
  const f = await fixture();
  const account = {
    address: f.signer.address,
    publicKey: new Uint8Array(
      await crypto.subtle.exportKey("raw", f.signer.keyPair.publicKey),
    ),
    chains: ["solana:localnet"],
    features: ["solana:signTransaction"],
  };
  let modify = false;
  const signer = {
    address: f.signer.address,
    modifyAndSignTransactions: async () => [
      modify
        ? {
            ...f.signed,
            messageBytes: Uint8Array.from(f.signed.messageBytes, (b, i) =>
              i === f.signed.messageBytes.length - 1 ? b ^ 1 : b,
            ),
          }
        : f.signed,
    ],
  };
  const state = {
    status: "connected",
    wallets: [],
    reconnectingTo: null,
    connected: {
      account,
      wallet: {
        name: "Test",
        accounts: [account],
        chains: ["solana:localnet"],
        features: ["solana:signTransaction"],
      },
      signer,
      supportedTransactionVersions: new Set([0]),
    },
  } as unknown as WalletState;
  const boundary = createWalletBoundary(
    {
      getState: () => state,
      subscribe: () => () => {},
      connect: async () => [],
      disconnect: async () => {},
      selectAccount: () => {},
    },
    "localnet",
  );
  assert.equal(
    await boundary.signPreparedTransaction(f.operation, new AbortController().signal),
    f.wire,
  );
  modify = true;
  await assert.rejects(
    boundary.signPreparedTransaction(f.operation, new AbortController().signal),
  );
  boundary.dispose();
  f.flow.dispose();
});
test("public RPC configuration excludes credentials, mainnet and insecure Devnet", () => {
  for (const url of [
    "https://user:secret@example.com",
    "https://api.mainnet-beta.solana.com",
    "https://rpc.example.com?api-key=SECRET",
    "http://rpc.example.com",
  ])
    assert.throws(() => publicTransactionRpcUrl("devnet", url));
  assert.match(publicTransactionRpcUrl("localnet"), /127.0.0.1:8899/);
});

test("Kit RPC checks genesis, preserves simulation bytes and submits once with preflight", async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  const calls: { method: string; params: unknown[] }[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = (await request.json()) as {
      id: number;
      method: string;
      params: unknown[];
    };
    calls.push(body);
    const result =
      body.method === "getGenesisHash"
        ? "11111111111111111111111111111111"
        : body.method === "getBlockHeight"
          ? 1
          : body.method === "simulateTransaction"
            ? { context: { slot: 2 }, value: { err: null, unitsConsumed: 220 } }
            : body.method === "getFeeForMessage"
              ? { context: { slot: 2 }, value: 5000 }
              : f.signature;
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
  try {
    const { createTransactionRpc } = await import("../lib/transaction-rpc.ts");
    const rpc = createTransactionRpc("localnet");
    const signal = new AbortController().signal;
    assert.equal(await rpc.height(signal), 1n);
    assert.equal((await rpc.simulate(f.operation, signal)).feeLamports, "5000");
    await rpc.submit(f.wire, signal);
    const simulation = calls.find((call) => call.method === "simulateTransaction")!;
    assert.equal(simulation.params[0], f.operation.transactionBase64);
    assert.deepEqual(simulation.params[1], {
      commitment: "confirmed",
      encoding: "base64",
      minContextSlot: 1,
      replaceRecentBlockhash: false,
      sigVerify: false,
    });
    const submit = calls.filter((call) => call.method === "sendTransaction");
    assert.equal(submit.length, 1);
    assert.equal(submit[0]!.params[0], f.wire);
    assert.deepEqual(submit[0]!.params[1], {
      encoding: "base64",
      maxRetries: 0,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    f.flow.dispose();
  }
});
