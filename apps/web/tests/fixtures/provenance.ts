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
