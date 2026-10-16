import { AccountRole, address, compileTransaction, isSignerRole } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { beforeEach, expect, it } from "vitest";
import {
  buildCreateListingTransaction,
  buildCancelListingTransaction,
  buildExpireListingTransaction,
  buildPurchaseListingTransaction,
} from "../src/index.js";
import * as market from "../src/generated/marketplace/index.js";
import {
  marketplaceTransactionFixture,
  snapshot,
} from "./fixtures/marketplace-transactions.js";

let f: Awaited<ReturnType<typeof marketplaceTransactionFixture>>;
beforeEach(async () => {
  f = await marketplaceTransactionFixture();
});
const revision = () => ({ kathaId: f.kathaId, expectedRevision: 1n });
const quote = () => ({
  ...revision(),
  buyerAddress: f.buyer,
  paymentMintAddress: f.mint,
  expectedPrice: "100000000",
});
const purchase = () => buildPurchaseListingTransaction(f.context, f.accounts, quote());
function listing(overrides: Partial<market.ListingRecordArgs>) {
  f.accounts.listingAccount = snapshot(
    f.listing,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    Uint8Array.from(
      market.getListingRecordEncoder().encode({ ...f.ledger, ...overrides }),
    ),
  );
}

it("builds an unsigned buyer-bound purchase with canonical accounts, ATAs and exact amounts", async () => {
  const result = await purchase();
  const parsed = market.parsePurchaseListingInstruction(result.instruction);
  expect(parsed.data).toMatchObject({
    expectedRevision: 1n,
    expectedPrice: 100_000_000n,
  });
  expect(parsed.accounts.buyer).toEqual({
    address: f.buyer,
    role: AccountRole.WRITABLE_SIGNER,
  });
  expect(parsed.accounts.seller.role).toBe(AccountRole.READONLY);
  expect(result.requiredSignerAddresses).toEqual([f.context.feePayerAddress, f.buyer]);
  expect(result.addresses).toMatchObject({
    config: f.config,
    artwork: f.artwork,
    asset: f.asset,
    listing: f.listing,
    saleTerms: f.saleTerms,
    paymentMint: f.mint,
  });
  for (const [wallet, tokenAccount] of [
    [f.buyer, result.addresses.buyerTokens],
    [f.seller, result.addresses.sellerTokens],
    [f.artist, result.addresses.artistTokens],
    [f.treasury, result.addresses.treasuryTokens],
  ] as const) {
    expect(tokenAccount).toBe(
      (
        await findAssociatedTokenPda({
          owner: wallet,
          mint: f.mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        })
      )[0],
    );
  }
  expect(result.instruction.accounts.every((meta) => !("signer" in meta))).toBe(true);
  expect(compileTransaction(result.transactionMessage).signatures[f.buyer]).toBeNull();
  expect(result.nextRevision).toBe(2n);
  expect(result.transactionMessage.version).toBe(0);
});

it("preserves wallet version selection, separate fee payer and blockhash expiry", async () => {
  const v1 = await buildPurchaseListingTransaction(
    { ...f.context, cluster: "devnet" },
    f.accounts,
    quote(),
  );
  expect(v1.transactionMessage.version).toBe(1);
  expect(v1.transactionMessage.lifetimeConstraint).toEqual(f.context.lifetime);
  const fallback = await buildPurchaseListingTransaction(
    {
      ...f.context,
      cluster: "devnet",
      supportedTransactionVersions: new Set([0]),
      feePayerAddress: f.buyer,
    },
    f.accounts,
    quote(),
  );
  expect(fallback.transactionMessage.version).toBe(0);
  expect(fallback.requiredSignerAddresses).toEqual([f.buyer]);
  for (const override of [
    { cluster: "mainnet" },
    { supportedTransactionVersions: new Set(["legacy"]) },
    { currentBlockHeight: 101n },
  ]) {
    await expect(
      buildPurchaseListingTransaction(
        { ...f.context, ...override } as typeof f.context,
        f.accounts,
        quote(),
      ),
    ).rejects.toThrow();
  }
});

it("binds the reviewed buyer, mint, price and revision and rejects self-purchase", async () => {
  for (const override of [
    { buyerAddress: f.artist },
    { paymentMintAddress: f.artist },
    { expectedPrice: "1" },
    { expectedRevision: 0n },
    { expectedPrice: "0" },
    { expectedPrice: "01" },
    { expectedPrice: "18446744073709551616" },
  ]) {
    await expect(
      buildPurchaseListingTransaction(f.context, f.accounts, {
        ...quote(),
        ...override,
      }),
    ).rejects.toThrow();
  }
  await expect(
    buildPurchaseListingTransaction(
      { ...f.context, authorityAddress: f.seller },
      f.accounts,
      { ...quote(), buyerAddress: f.seller },
    ),
  ).rejects.toThrow();
  await expect(
    buildPurchaseListingTransaction(
      { ...f.context, chainTime: f.ledger.expiresAt as bigint },
      f.accounts,
      quote(),
    ),
  ).rejects.toThrow();
});

it.each([
  "marketplaceConfigAccount",
  "registryConfigAccount",
  "artworkAccount",
  "assetAccount",
  "collectionAccount",
  "listingAccount",
  "saleTermsAccount",
  "conditionHeadAccount",
] as const)("rejects substituted or malformed %s", async (key) => {
  const original = f.accounts[key];
  for (const override of [
    { address: f.buyer },
    { programAddress: f.buyer },
    { data: new Uint8Array() },
    { executable: true },
  ]) {
    await expect(
      buildPurchaseListingTransaction(
        f.context,
        { ...f.accounts, [key]: { ...original, ...override } },
        quote(),
      ),
    ).rejects.toThrow();
  }
});

it("rejects forged marketplace configuration, listing bindings and historical state", async () => {
  const original = f.accounts.marketplaceConfigAccount;
  for (const override of [
    { version: 2 },
    { bump: (f.configuration.bump + 1) % 256 },
    { paymentDecimals: 9 },
    { tokenProgram: f.buyer },
    { registryProgram: f.buyer },
    { registryConfig: f.buyer },
    { collection: f.buyer },
    { treasury: f.buyer },
    { commissionBps: 10_000 },
    { inspectionValiditySeconds: 0n },
  ]) {
    f.accounts.marketplaceConfigAccount = snapshot(
      f.config,
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      Uint8Array.from(
        market
          .getMarketplaceConfigEncoder()
          .encode({ ...f.configuration, ...override }),
      ),
    );
    await expect(purchase()).rejects.toThrow();
  }
  f.accounts.marketplaceConfigAccount = original;
  for (const override of [
    { config: f.buyer },
    { artwork: f.buyer },
    { asset: f.buyer },
    { seller: f.buyer },
    { artistPayout: f.buyer },
    { paymentMint: f.buyer },
    { conditionReport: f.buyer },
    { conditionVersion: 2 },
    { conditionHash: new Uint8Array(32).fill(9) },
    { revision: 2n },
    { saleKind: market.SaleKind.Secondary },
    { status: market.ListingStatus.Cancelled },
  ]) {
    listing(override);
    await expect(purchase()).rejects.toThrow();
  }
});

it("preserves overlapping payout wallets as one canonical destination and rejects buyer payout aliases", async () => {
  const [terms, bump] = await market.findSaleTermsPda({ artwork: f.artwork });
  listing({ artistPayout: f.treasury });
  f.accounts.saleTermsAccount = snapshot(
    terms,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    Uint8Array.from(
      market
        .getArtworkSaleTermsEncoder()
        .encode({ version: 1, artwork: f.artwork, artistPayout: f.treasury, bump }),
    ),
  );
  const result = await purchase();
  expect(result.addresses.artistTokens).toBe(result.addresses.treasuryTokens);
  expect(
    result.instruction.accounts.filter(
      (meta) => meta.address === result.addresses.treasuryTokens,
    ),
  ).toHaveLength(2);
  await expect(
    buildPurchaseListingTransaction(
      { ...f.context, authorityAddress: f.treasury },
      f.accounts,
      { ...quote(), buyerAddress: f.treasury },
    ),
  ).rejects.toThrow();
});

it("creates first and replacement listings only for the current owner and exact revision", async () => {
  const context = { ...f.context, authorityAddress: f.seller };
  const input = {
    kathaId: f.kathaId,
    expectedRevision: 0n,
    price: "18446744073709551615",
    expiresAt: f.context.chainTime + 100n,
  };
  f.accounts.listingAccount = { exists: false, address: f.listing };
  const first = await buildCreateListingTransaction(context, f.accounts, input);
  expect(
    market.parseCreateListingWithFeesInstruction(first.instruction).data,
  ).toMatchObject({
    price: (1n << 64n) - 1n,
    expectedRevision: 0n,
    expiresAt: input.expiresAt,
  });
  expect(first.requiredSignerAddresses).toEqual([context.feePayerAddress, f.seller]);
  expect(first.addresses.conditionReport).toBe(f.report);
  f.accounts.listingAccount = snapshot(
    f.listing,
    address("11111111111111111111111111111111"),
    new Uint8Array(),
  );
  await expect(
    buildCreateListingTransaction(context, f.accounts, input),
  ).resolves.toBeDefined();
  listing({ status: market.ListingStatus.Cancelled });
  expect(
    (
      await buildCreateListingTransaction(context, f.accounts, {
        ...input,
        expectedRevision: 1n,
      })
    ).nextRevision,
  ).toBe(2n);
  await expect(
    buildCreateListingTransaction(context, f.accounts, input),
  ).rejects.toThrow();
  listing({});
  await expect(
    buildCreateListingTransaction(context, f.accounts, {
      ...input,
      expectedRevision: 1n,
    }),
  ).rejects.toThrow();
});

it("rejects invalid listing amounts, actor, times and integer revisions", async () => {
  f.accounts.listingAccount = { exists: false, address: f.listing };
  const context = { ...f.context, authorityAddress: f.seller };
  const input = {
    kathaId: f.kathaId,
    expectedRevision: 0n,
    price: "1",
    expiresAt: f.context.chainTime + 100n,
  };
  for (const override of [
    { price: "0" },
    { price: "1.5" },
    { price: " 1" },
    { price: "18446744073709551616" },
    { expiresAt: f.context.chainTime },
    { expiresAt: 1n << 63n },
    { expectedRevision: -1n },
    { expectedRevision: (1n << 64n) - 1n },
  ]) {
    await expect(
      buildCreateListingTransaction(context, f.accounts, { ...input, ...override }),
    ).rejects.toThrow();
  }
  await expect(
    buildCreateListingTransaction(f.context, f.accounts, input),
  ).rejects.toThrow();
  await expect(
    buildCreateListingTransaction({ ...context, chainTime: 0n }, f.accounts, input),
  ).rejects.toThrow();
});

it("requires seller cancellation but permits any signer at the inclusive expiry boundary", async () => {
  await expect(
    buildCancelListingTransaction(f.context, f.accounts, revision()),
  ).rejects.toThrow();
  const cancelled = await buildCancelListingTransaction(
    { ...f.context, authorityAddress: f.seller },
    f.accounts,
    revision(),
  );
  expect(
    market.parseCancelListingInstruction(cancelled.instruction).data.expectedRevision,
  ).toBe(1n);
  expect(cancelled.requiredSignerAddresses).toContain(f.seller);
  await expect(
    buildExpireListingTransaction(f.context, f.accounts, revision()),
  ).rejects.toThrow();
  const expired = await buildExpireListingTransaction(
    { ...f.context, chainTime: f.ledger.expiresAt as bigint },
    f.accounts,
    revision(),
  );
  expect(
    market.parseExpireListingInstruction(expired.instruction).accounts.actor.address,
  ).toBe(f.buyer);
  expect(
    expired.instruction.accounts
      .filter((meta) => isSignerRole(meta.role))
      .map((meta) => meta.address),
  ).toEqual([f.buyer]);
  // Cancellation remains possible after expiry and needs no current condition head.
  await expect(
    buildCancelListingTransaction(
      {
        ...f.context,
        authorityAddress: f.seller,
        chainTime: (f.ledger.expiresAt as bigint) + 1n,
      },
      f.accounts,
      revision(),
    ),
  ).resolves.toBeDefined();
  listing({ status: market.ListingStatus.Purchased });
  await expect(
    buildExpireListingTransaction(
      { ...f.context, chainTime: f.ledger.expiresAt as bigint },
      f.accounts,
      revision(),
    ),
  ).rejects.toThrow();
});

it("re-lists completed primary and secondary sales while rejecting impossible historical sale kinds", async () => {
  const input = {
    ...revision(),
    price: "100000000",
    expiresAt: f.context.chainTime + 3600n,
  };
  const context = { ...f.context, authorityAddress: f.seller };
  for (const completedSales of [1n, 2n]) {
    listing({
      status: market.ListingStatus.Purchased,
      completedSales,
      saleKind:
        completedSales === 1n ? market.SaleKind.Primary : market.SaleKind.Secondary,
    });
    await expect(
      buildCreateListingTransaction(context, f.accounts, input),
    ).resolves.toMatchObject({ nextRevision: 2n });
  }
  for (const overrides of [
    { completedSales: 0n, saleKind: market.SaleKind.Primary },
    { completedSales: 1n, saleKind: market.SaleKind.Secondary },
    { completedSales: 2n, saleKind: market.SaleKind.Primary },
  ]) {
    listing({ status: market.ListingStatus.Purchased, ...overrides });
    await expect(
      buildCreateListingTransaction(context, f.accounts, input),
    ).rejects.toThrow();
  }
});
