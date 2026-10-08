import {
  purchaseQuoteResponseSchema,
  publicArtworkDetailSchema,
  canonicalDocumentBytes,
  sha256Hex,
  type PurchaseQuoteTerms,
} from "@katha/shared";
import { calculateMarketplaceDistribution } from "@katha/solana";
import { findArtworkPda, findAssetPda } from "@katha/solana/registry";
import { findListingPda } from "@katha/solana/marketplace";
import { artworkFixture } from "./artwork.ts";
export async function purchaseQuoteFixture(
  kind: "PRIMARY" | "SECONDARY" = "PRIMARY",
  price = "100000001",
  overlap = false,
) {
  const kathaId = artworkFixture.kathaId;
  const [record] = await findArtworkPda({ kathaId });
  const [asset] = await findAssetPda({ artwork: record });
  const [listing] = await findListingPda({ asset });
  const terms: PurchaseQuoteTerms = {
    schemaVersion: 1,
    kathaId,
    cluster: "localnet",
    buyer: "11111111111111111111111111111112",
    asset,
    listing,
    revision: "2",
    price,
    expiresAt: "1900000000",
    saleKind: kind,
    seller: "11111111111111111111111111111113",
    artistPayout: overlap
      ? "11111111111111111111111111111113"
      : "11111111111111111111111111111114",
    treasury: "11111111111111111111111111111115",
    payment: {
      kind: "DEVNET_TEST_TOKEN",
      paymentMint: "11111111111111111111111111111116",
      decimals: 6,
      simulation: true,
      label: "Katha test token (no monetary value)",
    },
    fees: { platformCommissionBps: 250, secondaryRoyaltyBps: 500 },
    distribution: {
      sellerProceeds: "0",
      artistProceeds: "0",
      treasuryFee: "0",
      recipients: [],
    },
    condition: {
      report: "11111111111111111111111111111117",
      hash: "a".repeat(64),
      version: 1,
    },
    custodyRevision: "9",
  };
  terms.distribution = calculateMarketplaceDistribution(price, kind, terms.fees, terms);
  return {
    quote: purchaseQuoteResponseSchema.parse({
      ...terms,
      quoteHash: await sha256Hex(canonicalDocumentBytes(terms)),
      commitment: "finalized",
      observedSlot: "20",
      chainTime: "1800000000",
      simulation: { slot: "20", unitsConsumed: "200" },
    }),
    artwork: publicArtworkDetailSchema.parse({
      ...artworkFixture,
      chain: {
        ...artworkFixture.chain,
        coreAssetAddress: asset,
        registryRecordAddress: record,
      },
    }),
  };
}
