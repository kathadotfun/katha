import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateKeyPairSigner,
  signTransaction,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { purchaseFixture } from "./fixtures/purchase.ts";
import {
  inspectPreparedTransaction,
  decodeCanonicalTransaction,
} from "../lib/prepared-transaction.ts";
import {
  createTransactionLifecycle,
  idleTransactionSnapshot,
} from "../lib/transaction-lifecycle.ts";
import { createPurchaseQuote } from "../lib/purchase-quote.ts";
import { createWalletSessionApi } from "../lib/wallet-session-api.ts";
import { purchaseHistoryMatches } from "../lib/purchase-confirmation.ts";
import { provenanceFixture } from "./fixtures/provenance.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import type { WalletConnection } from "../lib/wallet-connection.ts";
test("purchase checks every reviewed payment and account binding", async () => {
  const base = await purchaseFixture();
  await inspectPreparedTransaction(base.operation, base.expected);
  for (const patch of [
    { price: 1n },
    { revision: 1n },
    { mint: base.quote.seller },
    { tokenAccount: base.quote.treasury },
    { coreProgram: base.quote.seller },
  ]) {
    const { operation } = await purchaseFixture(undefined, patch);
    await assert.rejects(inspectPreparedTransaction(operation, base.expected));
  }
  for (const operation of [
    { ...base.operation, nextRevision: "4" },
    { ...base.operation, quote: { ...base.quote, quoteHash: "f".repeat(64) } },
    {
      ...base.operation,
      quote: {
        ...base.quote,
        condition: { ...base.quote.condition, hash: "f".repeat(64) },
      },
    },
  ])
    await assert.rejects(inspectPreparedTransaction(operation, base.expected));
  await assert.rejects(
    inspectPreparedTransaction(base.operation, {
      kind: base.expected.kind,
      kathaId: base.expected.kathaId,
      wallet: base.expected.wallet,
      cluster: base.expected.cluster,
    }),
  );
  await assert.rejects(
    inspectPreparedTransaction(base.operation, {
      ...base.expected,
      purchase: { ...base.expected.purchase, collection: base.quote.treasury },
    }),
  );
});
test("private purchase transport binds path and reviewed quote without buyer overrides", async () => {
  const { operation } = await purchaseFixture();
  const input = {
    idempotencyKey: "synthetic",
    quoteHash: operation.quote.quoteHash,
    supportedTransactionVersions: [0 as const],
  };
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      `http://localhost:3001/artworks/${operation.kathaId}/operations/purchase`,
    );
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return Response.json({
      ...operation,
      quote: { ...operation.quote, quoteHash: "f".repeat(64) },
    });
  });
  await assert.rejects(
    api.preparePurchase(
      operation.kathaId,
      input,
      "synthetic",
      new AbortController().signal,
    ),
  );
});
test("purchase controller coalesces, clears stale quotes and prevents replacing an uncertain signature", async () => {
  const { operation, quote, artwork } = await purchaseFixture();
  const session = {
    walletId: "aaaaaaaa-1111-4111-8111-111111111111",
    walletAddress: quote.buyer,
    cluster: "localnet" as const,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  let phase = idleTransactionSnapshot,
    fail = true,
    prepares = 0,
    loads = 0;
  let auth: WalletSessionSnapshot = { status: "signed-in", session, error: null };
  const listeners = new Set<() => void>();
  let gate: Promise<typeof operation> | null = null;
  let release: ((value: typeof operation) => void) | null = null;
  const controller = createPurchaseQuote(
    {
      getSnapshot: () => auth,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      readPurchaseQuote: async () => quote,
      preparePurchase: async (_, input) => {
        prepares++;
        assert.equal(input.quoteHash, quote.quoteHash);
        if (fail) throw new Error("PRIVATE");
        return gate ?? operation;
      },
    },
    {
      cluster: "localnet",
      subscribe: () => () => {},
      getSnapshot: () => ({
        status: "connected",
        wallets: [],
        connected: {
          walletId: "synthetic",
          walletName: "Synthetic",
          address: quote.buyer,
          accounts: [quote.buyer],
          supportsV0: true,
          supportsV1: false,
          supportsMessageSigning: true,
        },
      }),
    },
    {
      artwork: async () => ({
        ...artwork,
        chain: { ...artwork.chain, collectionAddress: null },
      }),
      provenance: async () => ({
        ...provenanceFixture,
        kathaId: artwork.kathaId,
        attribution: { artist: artwork.artist, creatorWallet: artwork.creatorWallet },
        chain: artwork.chain,
        items: [],
      }),
    },
    quote.kathaId,
    {
      getSnapshot: () => phase,
      load: async () => {
        loads++;
      },
    },
  );
  await controller.refresh();
  assert.equal(controller.getSnapshot().collection, artwork.chain.collectionAddress);
  await Promise.all([controller.prepare(), controller.prepare()]);
  assert.equal(prepares, 1);
  assert.equal(controller.getSnapshot().quote, null);
  assert.match(controller.getSnapshot().preparationError!, /stale/);
  fail = false;
  await controller.refresh();
  phase = { ...phase, phase: "unknown", signature: "1".repeat(88) };
  await controller.prepare();
  assert.equal(prepares, 1);
  phase = idleTransactionSnapshot;
  await controller.prepare();
  assert.equal(loads, 1);
  assert.equal(controller.getSnapshot().quote, null);
  await controller.refresh();
  gate = new Promise((done) => {
    release = done;
  });
  const pending = controller.prepare();
  auth = { status: "signed-out", session: null, error: null };
  for (const fn of listeners) fn();
  release!(operation);
  await pending;
  assert.equal(loads, 1);
  assert.equal(controller.getSnapshot().status, "locked");
  controller.dispose();
  assert.equal(listeners.size, 0);
});
for (const scenario of ["success", "unknown", "failed", "rejected"] as const)
  test(`purchase ${scenario}: explicit approval, exact signature, separate finalized owner and indexer checks`, async () => {
    const signer = await generateKeyPairSigner();
    const { operation, expected } = await purchaseFixture(signer.address);
    const signed = await signTransaction(
      [signer.keyPair],
      decodeCanonicalTransaction(operation.transactionBase64),
    );
    const signature = String(getSignatureFromTransaction(signed));
    let signedCalls = 0,
      submissions = 0,
      receipts = 0,
      owner = false,
      indexed = false;
    const connection: WalletConnection = {
      cluster: "localnet",
      getSnapshot: () => ({
        status: "connected",
        wallets: [],
        connected: {
          walletId: "synthetic",
          walletName: "Synthetic",
          address: signer.address,
          accounts: [signer.address],
          supportsV0: true,
          supportsV1: false,
          supportsMessageSigning: true,
        },
      }),
      subscribe: () => () => {},
      signPreparedTransaction: async () => {
        signedCalls++;
        if (scenario === "rejected") throw new Error("Rejected");
        return String(getBase64EncodedWireTransaction(signed));
      },
      connect: async () => {},
      disconnect: async () => {},
      selectAccount: () => {},
      signLoginChallenge: async () => "",
      dispose: () => {},
    };
    const flow = createTransactionLifecycle(
      connection,
      {
        getSnapshot: () => ({
          status: "signed-in",
          session: {
            walletId: "aaaaaaaa-1111-4111-8111-111111111111",
            walletAddress: signer.address,
            cluster: "localnet",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
          error: null,
        }),
        subscribe: () => () => {},
        reconcile: async () => {
          receipts++;
          const status =
            receipts === 1 || scenario === "unknown"
              ? ("UNKNOWN" as const)
              : scenario === "failed"
                ? ("FAILED" as const)
                : ("FINALIZED" as const);
          return {
            receiptId: operation.operationId,
            operationId: operation.operationId,
            preparationId: operation.preparationId,
            kind: operation.kind,
            cluster: operation.cluster,
            signature,
            messageHash: operation.messageHash,
            status,
            operationStatus: status,
            failureCode: null,
            slot: status === "FINALIZED" ? "30" : null,
            chainRecordedAt: status === "FINALIZED" ? new Date().toISOString() : null,
          };
        },
      },
      {
        height: async () => 1n,
        simulate: async () => ({
          slot: "20",
          unitsConsumed: "200",
          feeLamports: "5000",
        }),
        submit: async () => {
          submissions++;
        },
      },
      async () => provenanceFixture,
      async () => indexed,
      async (_, slot) => {
        assert.equal(slot, "30");
        return owner;
      },
    );
    await flow.load(operation, expected);
    assert.equal(flow.getSnapshot().phase, "review");
    assert.equal(signedCalls, 0);
    await flow.approveAndSend();
    assert.equal(signedCalls, 1);
    if (scenario === "success") {
      assert.equal(flow.getSnapshot().phase, "indexing-delay");
      assert.equal(flow.getSnapshot().purchaseOwnerConfirmed, false);
      owner = true;
      await flow.checkConfirmation();
      assert.equal(flow.getSnapshot().purchaseOwnerConfirmed, true);
      assert.equal(flow.getSnapshot().phase, "indexing-delay");
      indexed = true;
      await flow.checkConfirmation();
      assert.equal(flow.getSnapshot().phase, "indexed");
      assert.equal(submissions, 1);
    } else if (scenario === "unknown") {
      assert.equal(flow.getSnapshot().phase, "unknown");
      await flow.load(operation, expected);
      assert.equal(flow.getSnapshot().phase, "unknown");
      await flow.checkConfirmation();
      assert.equal(submissions, 1);
    } else if (scenario === "failed") {
      assert.equal(flow.getSnapshot().phase, "failed");
      assert.equal(flow.getSnapshot().purchaseOwnerConfirmed, false);
    } else {
      assert.equal(flow.getSnapshot().phase, "not-completed");
      assert.equal(submissions, 0);
    }
    flow.dispose();
  });
test("purchase history requires the same successful transfer signature, asset, collection and buyer", async () => {
  const { operation } = await purchaseFixture();
  const signature = "1".repeat(88),
    item = provenanceFixture.items.find((value) => value.type === "TRANSFER")!;
  const history = {
    ...provenanceFixture,
    kathaId: operation.kathaId,
    chain: {
      ...provenanceFixture.chain,
      coreAssetAddress: operation.quote.asset,
      collectionAddress: (await purchaseFixture()).expected.purchase.collection,
    },
    items: [
      {
        ...item,
        transaction: { ...item.transaction, signature },
        data: {
          assetAddress: operation.quote.asset,
          newOwner: operation.feePayer,
          authorityWallet: operation.quote.seller,
          sale: null,
        },
      },
    ],
  };
  assert.equal(purchaseHistoryMatches(operation, signature, history), true);
  assert.equal(purchaseHistoryMatches(operation, "2".repeat(88), history), false);
  assert.equal(
    purchaseHistoryMatches(operation, signature, { ...history, items: [] }),
    false,
  );
  assert.equal(
    purchaseHistoryMatches(operation, signature, {
      ...history,
      chain: { ...history.chain, collectionAddress: operation.quote.seller },
    }),
    false,
  );
});
test("Core ownership RPC pins network, finalized commitment/receipt slot and validates account owner/collection/data", async () => {
  const { createPurchaseOwnershipRpc } =
    await import("../lib/purchase-confirmation.ts");
  const { getAddressEncoder, getU32Encoder } = await import("@solana/kit");
  const { CORE_PROGRAM_ADDRESS } = await import("@katha/solana");
  const { operation, expected } = await purchaseFixture();
  const enc = getAddressEncoder(),
    u32 = getU32Encoder();
  const text = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    return [...u32.encode(bytes.length), ...bytes];
  };
  let mode = "MATCH",
    reads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (_, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.method === "getGenesisHash")
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result:
          mode === "NETWORK"
            ? "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
            : "11111111111111111111111111111111",
      });
    assert.equal(body.method, "getAccountInfo");
    reads++;
    assert.equal(body.params[0], operation.quote.asset);
    // Kit omits its default finalized commitment when serializing RPC requests.
    assert.equal(body.params[1].commitment ?? "finalized", "finalized");
    assert.equal(body.params[1].minContextSlot, 30);
    const data = Uint8Array.from([
      1,
      ...enc.encode(
        (mode === "OWNER" ? operation.quote.seller : operation.feePayer) as Parameters<
          typeof enc.encode
        >[0],
      ),
      2,
      ...enc.encode(
        (mode === "COLLECTION"
          ? operation.quote.seller
          : expected.purchase.collection) as Parameters<typeof enc.encode>[0],
      ),
      ...text("Synthetic art"),
      ...text("https://katha.fun/test.json"),
      0,
    ]);
    if (mode === "DATA") data[0] = 255;
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        context: { slot: mode === "SLOT" ? 29 : 30 },
        value:
          mode === "MISSING"
            ? null
            : {
                data: [Buffer.from(data).toString("base64"), "base64"],
                owner:
                  mode === "PROGRAM" ? operation.quote.seller : CORE_PROGRAM_ADDRESS,
                executable: mode === "EXECUTABLE",
                lamports: 1000,
                space: data.length,
              },
      },
    });
  };
  try {
    const check = createPurchaseOwnershipRpc("localnet", "http://127.0.0.1:8899");
    assert.equal(await check(operation, "30", new AbortController().signal), true);
    mode = "OWNER";
    assert.equal(await check(operation, "30", new AbortController().signal), false);
    for (const value of [
      "PROGRAM",
      "COLLECTION",
      "DATA",
      "EXECUTABLE",
      "MISSING",
      "SLOT",
      "NETWORK",
    ]) {
      mode = value;
      await assert.rejects(check(operation, "30", new AbortController().signal));
    }
    assert.equal(reads, 8);
  } finally {
    globalThis.fetch = original;
  }
});
