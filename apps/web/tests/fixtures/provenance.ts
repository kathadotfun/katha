import { artworkProvenanceResponseSchema, canonicalDocumentBytes } from "@katha/shared";
import { artworkFixture as art } from "./artwork.ts";

export const metadataBytes = canonicalDocumentBytes({
  schemaVersion: 1,
  kathaId: art.kathaId,
  name: art.title,
  category: art.category,
  artist: {
    artistId: art.artist.id,
    displayName: art.artist.displayName,
    creatorWallet: art.creatorWallet,
  },
  creationYear: art.creationYear,
  origin: art.origin,
  dimensions: art.dimensions,
  materials: art.materials,
  technique: art.technique,
  publicContent: {
    story: art.story,
    meaning: art.meaning,
    culturalContext: art.culturalContext,
    creationProcess: art.creationProcess,
  },
  image: "https://example.com/synthetic.png",
  media: [
    {
      contentHash: "b".repeat(64),
      mimeType: "image/png",
      role: "HERO",
      uri: "https://example.com/synthetic.png",
    },
  ],
});
export const provenanceFixture = artworkProvenanceResponseSchema.parse({
  kathaId: art.kathaId,
  attribution: { artist: art.artist, creatorWallet: art.creatorWallet },
  chain: art.chain,
  items: [
    {
      id: "cccccccc-1111-4111-8111-111111111111",
      programAddress: art.chain.coreAssetAddress,
      transaction: art.ownership.transaction,
      position: {
        transactionIndex: 0,
        outerInstructionIndex: 0,
        innerInstructionIndex: -1,
        eventIndex: 0,
      },
      type: "TRANSFER",
      data: {
        assetAddress: art.chain.coreAssetAddress,
        newOwner: art.ownership.ownerWallet,
        authorityWallet: art.verification.verifierWallet,
      },
    },
  ],
  pagination: { limit: 20, offset: 0, hasMore: false },
  indexing: {
    status: "UNKNOWN",
    evaluatedAt: art.ownership.observedAt,
    network: null,
    streams: [
      { programAddress: art.chain.coreAssetAddress, checkpoint: null },
      { programAddress: art.verification.verifierWallet, checkpoint: null },
    ],
    ownerCheck: null,
  },
});

// Two synthetic purchases retain one transfer entry each and two inspection versions.
const base = provenanceFixture.items[0]!;
const walletA = "Vote111111111111111111111111111111111111111";
const walletB = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const sale = (primary: boolean, buyer: string, seller: string) => ({
  listingAddress: art.verification.verifierWallet,
  listingRevision: primary ? "1" : "2",
  marketplaceProgram: art.verification.verifierWallet,
  isPrimary: primary,
  sellerWallet: seller,
  buyerWallet: buyer,
  paymentMint: art.verification.verifierWallet,
  price: "1000000",
  proceedsWallet: primary ? art.verification.verifierWallet : seller,
  proceedsAmount: primary ? "975000" : "925000",
  artistWallet: art.verification.verifierWallet,
  royaltyAmount: primary ? "0" : "50000",
  treasuryWallet: art.verification.verifierWallet,
  platformFee: "25000",
});
const condition = (version: number) => ({
  ...base,
  id: `cccccccc-1111-4111-8111-${String(version + 10).padStart(12, "0")}`,
  type: "CONDITION",
  data: {
    version,
    reportAddress: art.verification.verifierWallet,
    documentHash: (version === 1 ? "c" : "d").repeat(64),
    grade: "GOOD",
    reason: version === 1 ? "INITIAL_VERIFICATION" : "PRE_RESALE",
    verifierWallet: art.verification.verifierWallet,
    inspectedAt: art.ownership.observedAt,
    recordedAt: art.ownership.observedAt,
    publicMedia:
      version === 1
        ? []
        : [
            {
              contentHash: art.media[0]!.contentHash,
              mimeType: "image/png",
              altText: "Approved synthetic resale inspection photograph",
            },
          ],
  },
});
export const collectingHistoryFixture = artworkProvenanceResponseSchema.parse({
  ...provenanceFixture,
  items: [
    base,
    condition(1),
    {
      ...base,
      id: "cccccccc-1111-4111-8111-000000000020",
      data: {
        ...base.data,
        newOwner: walletA,
        sale: sale(true, walletA, art.verification.verifierWallet),
      },
    },
    {
      ...base,
      id: "cccccccc-1111-4111-8111-000000000021",
      type: "CUSTODY",
      data: {
        revision: "2",
        fromState: "KATHA_HELD",
        toState: "IN_TRANSIT",
        attestedBy: art.verification.verifierWallet,
        recordedAt: art.ownership.observedAt,
      },
    },
    {
      ...base,
      id: "cccccccc-1111-4111-8111-000000000022",
      type: "CUSTODY",
      data: {
        revision: "3",
        fromState: "IN_TRANSIT",
        toState: "COLLECTOR_HELD",
        attestedBy: art.verification.verifierWallet,
        recordedAt: art.ownership.observedAt,
      },
    },
    condition(2),
    {
      ...base,
      id: "cccccccc-1111-4111-8111-000000000023",
      data: { ...base.data, newOwner: walletB, sale: sale(false, walletB, walletA) },
    },
  ],
});
