import type { WalletState } from "@solana/kit-plugin-wallet";
import { createWalletBoundary } from "../lib/wallet-connection.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  testTokenBaseUnits,
  listingExpiry,
  createOwnerListing,
  listingObservationMatches,
} from "../lib/owner-listing.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import { purchaseFixture } from "./fixtures/purchase.ts";
import { listingFixture, cancellationFixture } from "./fixtures/listing.ts";
import { createWalletSessionApi } from "../lib/wallet-session-api.ts";
import { collectionListingFixture } from "./fixtures/collection.ts";
import { provenanceFixture } from "./fixtures/provenance.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle.ts";
test("price conversion is exact and bounded without floating point", () => {
  assert.equal(testTokenBaseUnits("12.500001"), "12500001");
  assert.equal(testTokenBaseUnits("0.000001"), "1");
  assert.equal(testTokenBaseUnits("18446744073709.551615"), "18446744073709551615");
  for (const value of [
    "0",
    "-1",
    "1e3",
    " 1",
    "1,000",
    "1.0000001",
    "01",
    "18446744073709.551616",
  ])
    assert.throws(() => testTokenBaseUnits(value));
});
test("expiry rejects malformed and past local dates", () => {
  assert.throws(() => listingExpiry("not a date"));
  assert.throws(() => listingExpiry("2020-01-01T00:00"));
  assert.throws(() => listingExpiry("2030-02-30T00:00"));
  assert.equal(BigInt(listingExpiry("2030-01-01T00:00")) > 0n, true);
});
test("create listing wire binds all reviewed amounts, accounts and seller before simulation", async () => {
  const { operation, expected } = await listingFixture();
  const parsed = await inspectPreparedTransaction(operation, expected);
  assert.equal(parsed.operation.kind, "CREATE_LISTING");
  assert.equal(parsed.accounts.length, 15);
});
for (const mutation of [
  "price",
  "expiry",
  "revision",
  "seller",
  "program",
  "collection",
  "next revision",
])
  test(`listing inspection rejects changed ${mutation}`, async () => {
    const { operation, expected } = await listingFixture(
      mutation === "price"
        ? { price: 2n }
        : mutation === "expiry"
          ? { expiresAt: 1800000000n }
          : mutation === "revision"
            ? { expectedRevision: 2n }
            : mutation === "seller"
              ? { seller: "11111111111111111111111111111114" }
              : mutation === "program"
                ? { coreProgram: "11111111111111111111111111111114" }
                : {},
    );
    if (mutation === "collection")
      expected.listing.collection = "11111111111111111111111111111114";
    if (mutation === "next revision") operation.nextRevision = "2";
    await assert.rejects(inspectPreparedTransaction(operation, expected));
  });
test("listing transport sends validated terms privately and rejects substituted prices", async () => {
  const { operation } = await listingFixture();
  const input = {
    idempotencyKey: "synthetic-listing",
    expectedRevision: "0",
    price: operation.price,
    expiresAt: operation.expiresAt,
    supportedTransactionVersions: [0] as [0],
  };
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      `http://localhost:3001/artworks/${operation.kathaId}/operations/listing`,
    );
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    assert.equal(init?.cache, "no-store");
    assert.equal(JSON.parse(String(init?.body)).price, input.price);
    return Response.json({ ...operation, price: "2" });
  });
  await assert.rejects(
    api.prepareListing(
      operation.kathaId,
      input,
      "synthetic",
      new AbortController().signal,
    ),
  );
});
test("owner-only workflow rejects nonowner and active listings without preparing", async () => {
  const { operation } = await listingFixture();
  let page = {
    ...collectionListingFixture(operation.feePayer),
    kathaId: operation.kathaId,
    asset: (await listingFixture()).expected.listing.asset,
  };
  let auth: WalletSessionSnapshot = {
    status: "signed-in",
    session: {
      walletId: "aaaaaaaa-1111-4111-8111-111111111111",
      walletAddress: operation.feePayer,
      cluster: "localnet",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
    error: null,
  };
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  let prepares = 0;
  const workflow = createOwnerListing(
    {
      getSnapshot: () => auth,
      subscribe,
      prepareCancellation: async () => {
        throw new Error("Unexpected cancellation");
      },
      prepareListing: async () => {
        prepares++;
        return operation;
      },
    },
    {
      cluster: "localnet",
      subscribe,
      getSnapshot: () => ({
        status: "connected",
        wallets: [],
        connected: {
          walletId: "synthetic",
          walletName: "Synthetic",
          address: operation.feePayer,
          accounts: [operation.feePayer],
          supportsV0: true,
          supportsV1: false,
          supportsMessageSigning: true,
        },
      }),
    },
    { getSnapshot: () => idleTransactionSnapshot, load: async () => {} },
    {
      listing: async () => page,
      provenance: async () => ({
        ...provenanceFixture,
        kathaId: operation.kathaId,
        chain: {
          ...provenanceFixture.chain,
          coreAssetAddress: page.asset,
          collectionAddress: "11111111111111111111111111111113",
        },
      }),
    },
    operation.kathaId,
  );
  page = { ...page, owner: "11111111111111111111111111111114" };
  await workflow.read();
  await workflow.prepare("12.500001", "2030-01-01T00:00");
  assert.equal(prepares, 0);
  page = { ...page, owner: operation.feePayer };
  await workflow.read();
  assert.equal(workflow.canPrepare(), true);
  const originalPage = page;
  page = {
    ...page,
    listing: {
      address: "11111111111111111111111111111113",
      status: "ACTIVE" as const,
      revision: "1",
      completedSales: "0",
      saleKind: "PRIMARY" as const,
      seller: operation.feePayer,
      paymentMint: "11111111111111111111111111111114",
      decimals: 6 as const,
      price: "1000000",
      createdAt: "1700000000",
      expiresAt: "1900000000",
      active: true,
    },
  };
  await workflow.read();
  assert.equal(workflow.canPrepare(), false);
  await workflow.prepare("12.500001", "2030-01-01T00:00");
  assert.equal(prepares, 0);
  page = originalPage;
  await workflow.read();
  await workflow.prepare("0", "2030-01-01T00:00");
  assert.equal(prepares, 0);
  await workflow.prepare("12.500001", "2030-01-01T00:00");
  assert.equal(prepares, 1);
  assert.equal(workflow.getSnapshot().reloadRequired, true);
  await workflow.prepare("12.500001", "2030-01-01T00:00");
  assert.equal(prepares, 1);
  auth = { status: "signed-out", session: null, error: null };
  for (const listener of listeners) listener();
  assert.equal(workflow.getSnapshot().page, null);
  workflow.dispose();
  assert.equal(listeners.size, 0);
});

for (const kind of ["create", "cancel", "purchase"] as const)
  test(`${kind} listing lifecycle simulates, requires approval, signs exact wire and confirms indexing`, async () => {
    const { generateKeyPairSigner, signTransaction, getSignatureFromTransaction } =
      await import("@solana/kit");
    const { decodeCanonicalTransaction } =
      await import("../lib/prepared-transaction.ts");
    const { createTransactionLifecycle } =
      await import("../lib/transaction-lifecycle.ts");
    const signer = await generateKeyPairSigner();
    const { operation, expected } =
      kind === "purchase"
        ? await purchaseFixture(signer.address)
        : await (kind === "create" ? listingFixture : cancellationFixture)({
            wallet: signer.address,
          });
    const signed = await signTransaction(
      [signer.keyPair],
      decodeCanonicalTransaction(operation.transactionBase64),
    );
    const signature = getSignatureFromTransaction(signed);
    const calls: string[] = [];
    let receiptCalls = 0;
    const account = {
      address: signer.address,
      publicKey: new Uint8Array(
        await crypto.subtle.exportKey("raw", signer.keyPair.publicKey),
      ),
      chains: ["solana:localnet"],
      features: ["solana:signTransaction"],
    };
    const adapterState = {
      status: "connected",
      wallets: [],
      reconnectingTo: null,
      connected: {
        account,
        wallet: {
          name: "Synthetic",
          accounts: [account],
          chains: ["solana:localnet"],
          features: ["solana:signTransaction"],
        },
        signer: {
          address: signer.address,
          modifyAndSignTransactions: async () => {
            calls.push("sign");
            return [signed];
          },
        },
        supportedTransactionVersions: new Set([0]),
      },
    } as unknown as WalletState;
    const adapter = createWalletBoundary(
      {
        getState: () => adapterState,
        subscribe: () => () => {},
        connect: async () => [],
        disconnect: async () => {},
        selectAccount: () => {},
      },
      "localnet",
    );
    const connection = {
      cluster: "localnet" as const,
      getSnapshot: () => ({
        status: "connected" as const,
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
      signPreparedTransaction: adapter.signPreparedTransaction,
      connect: async () => {},
      disconnect: async () => {},
      selectAccount: () => {},
      signLoginChallenge: async () => "",
      dispose: () => {},
    };
    const session = {
      getSnapshot: () => ({
        status: "signed-in" as const,
        session: {
          walletId: "aaaaaaaa-1111-4111-8111-111111111111",
          walletAddress: signer.address,
          cluster: "localnet" as const,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
        error: null,
      }),
      subscribe: () => () => {},
      reconcile: async () => {
        calls.push("receipt");
        const status =
          ++receiptCalls === 1 ? ("UNKNOWN" as const) : ("FINALIZED" as const);
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
          slot: status === "FINALIZED" ? "12" : null,
          chainRecordedAt: status === "FINALIZED" ? new Date().toISOString() : null,
        };
      },
    };
    const flow = createTransactionLifecycle(
      connection,
      session,
      {
        height: async () => 1n,
        simulate: async () => {
          calls.push("simulate");
          return { slot: "1", unitsConsumed: "200", feeLamports: "5000" };
        },
        submit: async () => {
          calls.push("submit");
        },
      },
      async () => provenanceFixture,
      async () => true,
      async () => true,
    );
    await flow.load(operation, expected);
    assert.equal(flow.getSnapshot().phase, "review");
    assert.deepEqual(calls, ["simulate"]);
    await flow.approveAndSend();
    assert.equal(flow.getSnapshot().phase, "indexed");
    assert.deepEqual(calls, [
      "simulate",
      "simulate",
      "sign",
      "receipt",
      "submit",
      "receipt",
    ]);
    flow.dispose();
    adapter.dispose();
  });

test("finalized listing observation requires matching asset, ledger, seller and terms", async () => {
  const { findListingPda } = await import("@katha/solana/marketplace");
  const { address } = await import("@solana/kit");
  const { operation, expected } = await listingFixture();
  const [listing] = await findListingPda({ asset: address(expected.listing.asset) });
  const current = {
    ...collectionListingFixture(operation.feePayer),
    kathaId: operation.kathaId,
    asset: expected.listing.asset,
    currentRevision: "1",
    listing: {
      address: listing,
      status: "ACTIVE" as const,
      revision: "1",
      completedSales: "0",
      saleKind: "PRIMARY" as const,
      seller: operation.feePayer,
      paymentMint: "11111111111111111111111111111114",
      decimals: 6 as const,
      price: operation.price,
      createdAt: "1800000000",
      expiresAt: operation.expiresAt,
      active: true,
    },
  };
  assert.equal(await listingObservationMatches(operation, current), true);
  for (const patch of [
    { seller: "11111111111111111111111111111114" },
    { price: "1" },
    { revision: "2" },
    { active: false },
  ])
    assert.equal(
      await listingObservationMatches(operation, {
        ...current,
        listing: { ...current.listing, ...patch },
      }),
      false,
    );
  assert.equal(
    await listingObservationMatches(operation, {
      ...current,
      asset: operation.feePayer,
    }),
    false,
  );
  assert.equal(
    await listingObservationMatches(operation, { ...current, listing: null }),
    false,
  );
});
