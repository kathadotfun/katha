import { address } from "@solana/kit";
import {
  listingPriceSchema,
  marketplaceFeeRatesSchema,
  saleDistributionSchema,
} from "@katha/shared";
import { nonzeroAddress } from "./registration.js";
import {
  readMarketplaceListingState,
  type MarketplaceListingAccounts,
} from "./marketplace.js";
import * as market from "./generated/marketplace/index.js";

/** Preview mirrors Rust distribution.rs; only the program settles token payments. */
export function calculateMarketplaceDistribution(
  price: string,
  kind: "PRIMARY" | "SECONDARY",
  fees: { platformCommissionBps: number; secondaryRoyaltyBps: number },
  recipients: { seller: string; artistPayout: string; treasury: string },
) {
  const amount = BigInt(listingPriceSchema.parse(price));
  const rates = marketplaceFeeRatesSchema.parse(fees);
  if (kind !== "PRIMARY" && kind !== "SECONDARY")
    throw new TypeError("Invalid sale kind");
  const treasuryFee = (amount * BigInt(rates.platformCommissionBps)) / 10000n;
  const artistProceeds =
    kind === "PRIMARY"
      ? amount - treasuryFee
      : (amount * BigInt(rates.secondaryRoyaltyBps)) / 10000n;
  const sellerProceeds =
    kind === "PRIMARY" ? 0n : amount - treasuryFee - artistProceeds;
  const payments = new Map<string, bigint>();
  for (const [wallet, units] of [
    [recipients.seller, sellerProceeds],
    [recipients.artistPayout, artistProceeds],
    [recipients.treasury, treasuryFee],
  ] as const) {
    nonzeroAddress(address(wallet));
    if (units > 0n) payments.set(wallet, (payments.get(wallet) ?? 0n) + units);
  }
  return saleDistributionSchema.parse({
    sellerProceeds: sellerProceeds.toString(),
    artistProceeds: artistProceeds.toString(),
    treasuryFee: treasuryFee.toString(),
    recipients: [...payments].map(([wallet, units]) => ({
      wallet,
      amount: units.toString(),
    })),
  });
}
export async function readMarketplacePurchaseTerms(
  accounts: MarketplaceListingAccounts,
  kathaId: string,
  chainTime: bigint,
) {
  const state = await readMarketplaceListingState(accounts, kathaId, chainTime);
  if (
    !state.active ||
    !state.ledger ||
    state.revision === 18446744073709551615n ||
    state.ledger.completedSales === 18446744073709551615n
  )
    throw new TypeError("Listing unavailable for purchase");
  const config = market
    .getMarketplaceConfigDecoder()
    .decode(accounts.marketplaceConfigAccount.data);
  const ledger = state.ledger;
  const saleKind =
    ledger.saleKind === market.SaleKind.Primary
      ? ("PRIMARY" as const)
      : ("SECONDARY" as const);
  const fees = {
    platformCommissionBps: config.commissionBps,
    secondaryRoyaltyBps: config.secondaryRoyaltyBps,
  };
  const recipients = {
    seller: ledger.seller,
    artistPayout: ledger.artistPayout,
    treasury: config.treasury,
  };
  return {
    asset: state.asset,
    listing: state.listing,
    revision: state.revision.toString(),
    price: ledger.price.toString(),
    expiresAt: ledger.expiresAt.toString(),
    saleKind,
    ...recipients,
    fees,
    paymentMint: config.paymentMint,
    condition: {
      report: ledger.conditionReport,
      hash: Buffer.from(ledger.conditionHash).toString("hex"),
      version: ledger.conditionVersion,
    },
    custodyRevision: ledger.custodyRevision.toString(),
    distribution: calculateMarketplaceDistribution(
      ledger.price.toString(),
      saleKind,
      fees,
      recipients,
    ),
  };
}
