import { expect, it } from "vitest";
import {
  calculateMarketplaceDistribution,
  readMarketplacePurchaseTerms,
} from "../src/marketplace-quote.js";
import {
  marketplaceTransactionFixture,
  snapshot,
} from "./fixtures/marketplace-transactions.js";
import * as market from "../src/generated/marketplace/index.js";
const seller = "Vote111111111111111111111111111111111111111",
  artistPayout = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  treasury = "BPFLoaderUpgradeab1e11111111111111111111111";
const roles = { seller, artistPayout, treasury },
  fees = { platformCommissionBps: 250, secondaryRoyaltyBps: 500 };
it("matches Rust's primary, secondary and awkward rounding vectors", () => {
  expect(
    calculateMarketplaceDistribution("100000000", "PRIMARY", fees, roles),
  ).toMatchObject({
    sellerProceeds: "0",
    artistProceeds: "97500000",
    treasuryFee: "2500000",
  });
  expect(
    calculateMarketplaceDistribution("100000000", "SECONDARY", fees, roles),
  ).toMatchObject({
    sellerProceeds: "92500000",
    artistProceeds: "5000000",
    treasuryFee: "2500000",
  });
  expect(
    calculateMarketplaceDistribution("101", "SECONDARY", fees, roles),
  ).toMatchObject({ sellerProceeds: "94", artistProceeds: "5", treasuryFee: "2" });
});
it("conserves every base unit across u64 bounds, zero/full fees and independent floor rounding", () => {
  for (const price of ["1", "101", "9007199254740993", "18446744073709551615"])
    for (const commission of [0, 1, 250, 3333, 9999, 10000])
      for (const royalty of [0, 1, 500, 10000 - commission].filter(
        (n) => n + commission <= 10000,
      ))
        for (const kind of ["PRIMARY", "SECONDARY"] as const) {
          const result = calculateMarketplaceDistribution(
            price,
            kind,
            { platformCommissionBps: commission, secondaryRoyaltyBps: royalty },
            roles,
          );
          expect(
            BigInt(result.sellerProceeds) +
              BigInt(result.artistProceeds) +
              BigInt(result.treasuryFee),
          ).toBe(BigInt(price));
          expect(result.recipients.reduce((sum, v) => sum + BigInt(v.amount), 0n)).toBe(
            BigInt(price),
          );
          expect(new Set(result.recipients.map((v) => v.wallet)).size).toBe(
            result.recipients.length,
          );
        }
});
it.each([
  { seller, artistPayout: seller, treasury },
  { seller, artistPayout, treasury: seller },
  { seller, artistPayout, treasury: artistPayout },
  { seller, artistPayout: seller, treasury: seller },
])(
  "merges overlapping recipient wallets without losing role amounts %#",
  (recipients) => {
    const result = calculateMarketplaceDistribution(
      "100000000",
      "SECONDARY",
      fees,
      recipients,
    );
    expect(result.recipients.reduce((sum, v) => sum + BigInt(v.amount), 0n)).toBe(
      100000000n,
    );
    expect(result.recipients.length).toBe(new Set(Object.values(recipients)).size);
  },
);
it.each(["0", "-1", "1.5", "18446744073709551616"])(
  "rejects invalid exact price %s",
  (price) => {
    expect(() =>
      calculateMarketplaceDistribution(price, "PRIMARY", fees, roles),
    ).toThrow();
  },
);
it("rejects excessive fees even for primary and default recipient addresses even for zero roles", () => {
  expect(() =>
    calculateMarketplaceDistribution(
      "1",
      "PRIMARY",
      { platformCommissionBps: 6000, secondaryRoyaltyBps: 5000 },
      roles,
    ),
  ).toThrow();
  expect(() =>
    calculateMarketplaceDistribution("1", "PRIMARY", fees, {
      ...roles,
      seller: "11111111111111111111111111111111",
    }),
  ).toThrow();
});
it("builds quotes only from validated active bound listing state and actual configuration", async () => {
  const f = await marketplaceTransactionFixture();
  const terms = await readMarketplacePurchaseTerms(
    f.accounts,
    f.kathaId,
    f.context.chainTime,
  );
  expect(terms).toMatchObject({
    revision: "1",
    price: "100000000",
    paymentMint: f.mint,
    seller: f.seller,
    artistPayout: f.artist,
    treasury: f.treasury,
    saleKind: "PRIMARY",
    custodyRevision: "1",
    distribution: { artistProceeds: "97500000" },
  });
  await expect(
    readMarketplacePurchaseTerms(f.accounts, f.kathaId, BigInt(f.ledger.expiresAt)),
  ).rejects.toThrow();
  f.accounts.listingAccount = snapshot(
    f.listing,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    Uint8Array.from(
      market
        .getListingRecordEncoder()
        .encode({ ...f.ledger, status: market.ListingStatus.Cancelled }),
    ),
  );
  await expect(
    readMarketplacePurchaseTerms(f.accounts, f.kathaId, f.context.chainTime),
  ).rejects.toThrow();
});

it("quotes version-2 listings from their own fees and rejects missing or stale snapshots", async () => {
  const f = await marketplaceTransactionFixture();
  f.accounts.listingAccount = snapshot(
    f.listing,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    Uint8Array.from(
      market.getListingRecordEncoder().encode({ ...f.ledger, version: 2 }),
    ),
  );
  const [fees, bump] = await market.findListingFeesPda({ listing: f.listing });
  const set = (
    listingRevision: bigint,
    owner = market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  ) => {
    f.accounts.listingFeesAccount = snapshot(
      fees,
      owner,
      Uint8Array.from(
        market.getListingFeesEncoder().encode({
          version: 1,
          listing: f.listing,
          listingRevision,
          scheduleRevision: 1n,
          commissionBps: 1000,
          secondaryRoyaltyBps: 0,
          bump,
        }),
      ),
    );
  };
  await expect(
    readMarketplacePurchaseTerms(f.accounts, f.kathaId, f.context.chainTime),
  ).rejects.toThrow();
  set(1n);
  const quote = await readMarketplacePurchaseTerms(
    f.accounts,
    f.kathaId,
    f.context.chainTime,
  );
  expect(quote.fees).toEqual({ platformCommissionBps: 1000, secondaryRoyaltyBps: 0 });
  expect(quote.distribution).toMatchObject({
    artistProceeds: "90000000",
    treasuryFee: "10000000",
  });
  set(2n);
  await expect(
    readMarketplacePurchaseTerms(f.accounts, f.kathaId, f.context.chainTime),
  ).rejects.toThrow();
}, 30_000);
