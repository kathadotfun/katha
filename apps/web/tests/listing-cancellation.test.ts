import assert from "node:assert/strict";
import { test } from "node:test";
import { cancellationFixture } from "./fixtures/listing.ts";
import { inspectPreparedTransaction } from "../lib/prepared-transaction.ts";
import { createWalletSessionApi } from "../lib/wallet-session-api.ts";
import { createOwnerListing, listingObservationMatches } from "../lib/owner-listing.ts";
import { collectionListingFixture } from "./fixtures/collection.ts";
import { provenanceFixture } from "./fixtures/provenance.ts";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle.ts";
import type { ArtworkListingResponse } from "@katha/shared";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import { address } from "@solana/kit";
import { findListingPda } from "@katha/solana/marketplace";

for (const change of [
  "none",
  "actor",
  "revision",
  "program",
  "collection",
  "response terms",
])
  test(`cancellation instruction validates reviewed binding: ${change}`, async () => {
    const { operation, expected } = await cancellationFixture(
      change === "actor"
        ? { actor: "11111111111111111111111111111114" }
        : change === "revision"
          ? { revision: 2n }
          : change === "program"
            ? { coreProgram: "11111111111111111111111111111114" }
            : {},
    );
    if (change === "collection")
      expected.listing.collection = "11111111111111111111111111111114";
    if (change === "response terms") operation.price = "1";
    if (change === "none")
      assert.equal(
        (await inspectPreparedTransaction(operation, expected)).accounts.length,
        10,
      );
    else await assert.rejects(inspectPreparedTransaction(operation, expected));
  });

test("cancellation HTTP validates private request and rejects substituted operation", async () => {
  const { operation } = await cancellationFixture();
  let wrong = false;
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      `http://localhost:3001/artworks/${operation.kathaId}/operations/cancellation`,
    );
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(Object.keys(JSON.parse(String(init?.body))).sort(), [
      "expectedRevision",
      "idempotencyKey",
      "supportedTransactionVersions",
    ]);
    return Response.json({ ...operation, ...(wrong ? { currentRevision: "2" } : {}) });
  });
  const input = {
    expectedRevision: "1",
    idempotencyKey: "synthetic-release",
    supportedTransactionVersions: [0] as [0],
  };
  assert.equal(
    (
      await api.prepareCancellation(
        operation.kathaId,
        input,
        "synthetic",
        new AbortController().signal,
      )
    ).kind,
    "CANCEL_LISTING",
  );
  wrong = true;
  await assert.rejects(
    api.prepareCancellation(
      operation.kathaId,
      input,
      "synthetic",
      new AbortController().signal,
    ),
  );
});

test("seller releases before or after expiry; nonowner, wrong seller and uncertain signatures cannot prepare", async () => {
  const { operation, expected } = await cancellationFixture();
  const [listingAddress] = await findListingPda({
    asset: address(expected.listing.asset),
  });
  let page: ArtworkListingResponse = {
    ...collectionListingFixture(operation.feePayer),
    kathaId: operation.kathaId,
    asset: expected.listing.asset,
    listing: {
      address: listingAddress,
      status: "ACTIVE",
      revision: "1",
      completedSales: "0",
      saleKind: "PRIMARY",
      seller: operation.feePayer,
      paymentMint: "11111111111111111111111111111114",
      decimals: 6,
      price: operation.price,
      createdAt: "1700000000",
      expiresAt: operation.expiresAt,
      active: true,
    },
  };
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  let auth: WalletSessionSnapshot = {
    status: "signed-in",
    error: null,
    session: {
      walletId: "aaaaaaaa-1111-4111-8111-111111111111",
      walletAddress: operation.feePayer,
      cluster: "localnet",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    },
  };
  let prepared = 0,
    loaded = 0;
  let gate: Promise<typeof operation> | null = null;
  let resolveGate: ((value: typeof operation) => void) | undefined;
  let tx = idleTransactionSnapshot;
  const workflow = createOwnerListing(
    {
      getSnapshot: () => auth,
      subscribe,
      prepareListing: async () => {
        throw new Error("Unexpected creation");
      },
      prepareCancellation: async (_, input) => {
        assert.equal(input.expectedRevision, "1");
        prepared++;
        return gate ? await gate : operation;
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
    {
      getSnapshot: () => tx,
      load: async (op, review) => {
        assert.equal(op, operation);
        assert.deepEqual(review.listing, expected.listing);
        loaded++;
      },
    },
    {
      listing: async () => page,
      provenance: async () => ({
        ...provenanceFixture,
        kathaId: operation.kathaId,
        chain: {
          ...provenanceFixture.chain,
          coreAssetAddress: page.asset,
          collectionAddress: expected.listing.collection,
        },
      }),
    },
    operation.kathaId,
  );
  await workflow.read();
  assert.equal(workflow.canRelease(), true);
  page = { ...page, owner: "11111111111111111111111111111114" };
  await workflow.read();
  await workflow.release();
  assert.equal(prepared, 0);
  page = {
    ...page,
    owner: operation.feePayer,
    listing: { ...page.listing!, seller: "11111111111111111111111111111114" },
  };
  await workflow.read();
  await workflow.release();
  assert.equal(prepared, 0);
  page = {
    ...page,
    chainTime: operation.expiresAt,
    listing: { ...page.listing!, seller: operation.feePayer, active: false },
  };
  await workflow.read();
  assert.equal(workflow.canRelease(), true);
  tx = { ...idleTransactionSnapshot, phase: "unknown", signature: "3".repeat(88) };
  await workflow.release();
  assert.equal(prepared, 0);
  tx = idleTransactionSnapshot;
  await workflow.release();
  assert.equal(loaded, 1);
  assert.equal(workflow.getSnapshot().reloadRequired, true);
  await workflow.release();
  assert.equal(prepared, 1);
  page = {
    ...page,
    currentRevision: "2",
    listing: { ...page.listing!, revision: "2", status: "CANCELLED" },
  };
  await workflow.read();
  assert.equal(await listingObservationMatches(operation, page), true);
  assert.equal(workflow.canRelease(), false);
  tx = { ...idleTransactionSnapshot, phase: "indexed", signature: "3".repeat(88) };
  assert.equal(workflow.canPrepare(), true);
  assert.equal(
    await listingObservationMatches(operation, {
      ...page,
      listing: { ...page.listing!, status: "ACTIVE" },
    }),
    false,
  );
  page = {
    ...page,
    currentRevision: "1",
    listing: { ...page.listing!, status: "ACTIVE", revision: "1" },
  };
  tx = idleTransactionSnapshot;
  await workflow.read();
  gate = new Promise((resolve) => {
    resolveGate = resolve;
  });
  const pending = workflow.release();
  await workflow.release();
  assert.equal(prepared, 2);
  auth = { status: "signed-out", session: null, error: null };
  for (const fn of listeners) fn();
  assert.equal(workflow.getSnapshot().page, null);
  resolveGate!(operation);
  await pending;
  assert.equal(loaded, 1);
  workflow.dispose();
  assert.equal(listeners.size, 0);
});
