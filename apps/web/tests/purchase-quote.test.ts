import { provenanceFixture } from "./fixtures/provenance.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { purchaseQuoteFixture } from "./fixtures/purchase-quote.ts";
import {
  testTokenAmount,
  validatePurchaseQuote,
  createPurchaseQuote,
  purchaseCollection,
} from "../lib/purchase-quote.ts";
import { createWalletSessionApi } from "../lib/wallet-session-api.ts";
import type { WalletSessionSnapshot } from "../lib/wallet-session.ts";
import {
  canonicalDocumentBytes,
  sha256Hex,
  purchaseQuoteTermsSchema,
} from "@katha/shared";
test("display retains all six decimals and u64 precision", () => {
  assert.equal(testTokenAmount("0"), "0.000000");
  assert.equal(testTokenAmount("1"), "0.000001");
  assert.equal(testTokenAmount("18446744073709551615"), "18446744073709.551615");
  for (const invalid of ["-1", "01", "1.5", "18446744073709551616"])
    assert.throws(() => testTokenAmount(invalid));
});
for (const kind of ["PRIMARY", "SECONDARY"] as const)
  for (const overlap of [false, true])
    test(`${kind} exact rounded role amounts and merged recipients: overlap=${overlap}`, async () => {
      const { quote, artwork } = await purchaseQuoteFixture(
        kind,
        "18446744073709551615",
        overlap,
      );
      assert.equal(
        (
          await validatePurchaseQuote(quote, artwork, {
            kathaId: quote.kathaId,
            wallet: quote.buyer,
            cluster: "localnet",
          })
        ).quote.quoteHash,
        quote.quoteHash,
      );
      assert.equal(
        BigInt(quote.distribution.sellerProceeds) +
          BigInt(quote.distribution.artistProceeds) +
          BigInt(quote.distribution.treasuryFee),
        BigInt(quote.price),
      );
      assert.equal(
        quote.distribution.recipients.reduce(
          (sum, recipient) => sum + BigInt(recipient.amount),
          0n,
        ),
        BigInt(quote.price),
      );
    });
for (const change of [
  "buyer",
  "asset",
  "listing",
  "hash",
  "distribution",
  "expired",
  "artwork",
  "cluster",
])
  test(`purchase quote rejects changed ${change}`, async () => {
    const { quote, artwork } = await purchaseQuoteFixture();
    const other = "11111111111111111111111111111118";
    if (change === "buyer") quote.buyer = other;
    if (change === "asset") quote.asset = other;
    if (change === "listing") quote.listing = other;
    if (change === "hash") quote.quoteHash = "b".repeat(64);
    if (change === "distribution") {
      quote.distribution.artistProceeds = "1";
      const terms = purchaseQuoteTermsSchema.strip().parse(quote);
      quote.quoteHash = await sha256Hex(canonicalDocumentBytes(terms));
    }
    if (change === "expired") quote.chainTime = quote.expiresAt;
    if (change === "artwork") artwork.chain.coreAssetAddress = other;
    if (change === "cluster") quote.cluster = "devnet";
    await assert.rejects(
      validatePurchaseQuote(quote, artwork, {
        kathaId: quote.kathaId,
        wallet: "11111111111111111111111111111112",
        cluster: "localnet",
      }),
    );
  });
test("quote HTTP sends only versions privately and rejects wrong artwork", async () => {
  const { quote } = await purchaseQuoteFixture();
  const api = createWalletSessionApi("http://localhost:3001", async (url, init) => {
    assert.equal(
      String(url),
      `http://localhost:3001/artworks/${quote.kathaId}/purchase-quote`,
    );
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      supportedTransactionVersions: [0],
    });
    return Response.json({ ...quote, kathaId: "KATHA-PAUBHA-000002" });
  });
  await assert.rejects(
    api.readPurchaseQuote(
      quote.kathaId,
      { supportedTransactionVersions: [0] },
      "synthetic",
      new AbortController().signal,
    ),
  );
});
test("quote controller clears old terms on outage, coalesces requests and discards late revoked identity", async () => {
  const { quote, artwork } = await purchaseQuoteFixture();
  let auth: WalletSessionSnapshot = {
    status: "signed-in",
    session: {
      walletId: "aaaaaaaa-1111-4111-8111-111111111111",
      walletAddress: quote.buyer,
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
  let fail = false,
    reads = 0;
  let resolve: ((value: typeof quote) => void) | null = null;
  let gate: Promise<typeof quote> | null = null;
  const controller = createPurchaseQuote(
    {
      getSnapshot: () => auth,
      subscribe,
      preparePurchase: async () => {
        throw new Error("Unexpected prepare");
      },
      readPurchaseQuote: async (_, input) => {
        assert.deepEqual(input.supportedTransactionVersions, [0]);
        reads++;
        if (fail) throw new Error("PRIVATE_ERROR");
        return gate ?? quote;
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
          address: quote.buyer,
          accounts: [quote.buyer],
          supportsV0: true,
          supportsV1: false,
          supportsMessageSigning: true,
        },
      }),
    },
    {
      artwork: async () => artwork,
      provenance: async () => {
        throw new Error("Unexpected provenance read for a bound detail");
      },
    },
    quote.kathaId,
  );
  await controller.refresh();
  assert.equal(controller.getSnapshot().status, "ready");
  fail = true;
  await controller.refresh();
  assert.equal(controller.getSnapshot().quote, null);
  assert.equal(controller.getSnapshot().status, "unavailable");
  fail = false;
  gate = new Promise((done) => {
    resolve = done;
  });
  const pending = controller.refresh();
  await controller.refresh();
  assert.equal(reads, 3);
  auth = { status: "signed-out", session: null, error: null };
  for (const fn of listeners) fn();
  assert.equal(controller.getSnapshot().status, "locked");
  resolve!(quote);
  await pending;
  assert.equal(controller.getSnapshot().quote, null);
  controller.dispose();
  assert.equal(listeners.size, 0);
});

test("missing detail collection resolves from matching provenance and rejects mismatched bindings", async () => {
  const { artwork } = await purchaseQuoteFixture();
  const history = {
    ...provenanceFixture,
    kathaId: artwork.kathaId,
    attribution: { artist: artwork.artist, creatorWallet: artwork.creatorWallet },
    chain: artwork.chain,
    items: [],
  };
  assert.equal(
    await purchaseCollection(history, artwork),
    artwork.chain.collectionAddress,
  );
  for (const alter of [
    (h: typeof history) => {
      h.kathaId = "KATHA-THANGKA-000001";
    },
    (h: typeof history) => {
      h.chain = { ...h.chain, cluster: "DEVNET" };
    },
    (h: typeof history) => {
      h.chain = { ...h.chain, collectionAddress: null };
    },
    (h: typeof history) => {
      h.chain = {
        ...h.chain,
        registryRecordAddress: "11111111111111111111111111111111",
      };
    },
    (h: typeof history) => {
      h.chain = { ...h.chain, coreAssetAddress: "11111111111111111111111111111111" };
    },
    (h: typeof history) => {
      h.attribution.artist.id = "aaaaaaaa-1111-4111-8111-111111111112";
    },
  ]) {
    const corrupt = structuredClone(history);
    alter(corrupt);
    await assert.rejects(purchaseCollection(corrupt, artwork));
  }
  const network = {
    genesisHash: "11111111111111111111111111111111",
    collectionAddress: artwork.chain.collectionAddress!,
    observedFinalizedSlot: "20",
    observedAt: new Date().toISOString(),
    blocked: false,
  };
  assert.equal(
    await purchaseCollection(
      { ...history, indexing: { ...history.indexing, network } },
      artwork,
    ),
    network.collectionAddress,
  );
  for (const changed of [
    { ...network, blocked: true },
    { ...network, collectionAddress: "11111111111111111111111111111111" },
  ])
    await assert.rejects(
      purchaseCollection(
        { ...history, indexing: { ...history.indexing, network: changed } },
        artwork,
      ),
    );
});
