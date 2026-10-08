import {
  collectorCollectionResponseSchema,
  type ArtworkListingResponse,
} from "@katha/shared";
import { artworkFixture as art } from "./artwork.ts";
import { provenanceFixture } from "./provenance.ts";
export function collectionFixture(
  wallet = "11111111111111111111111111111112",
  offset = 0,
) {
  return collectorCollectionResponseSchema.parse({
    walletAddress: wallet,
    cluster: "localnet",
    evaluatedAt: new Date().toISOString(),
    items: offset
      ? []
      : [
          {
            artwork: {
              kathaId: art.kathaId,
              category: art.category,
              title: art.title,
              creationYear: art.creationYear,
              artist: {
                id: art.artist.id,
                slug: art.artist.slug,
                displayName: art.artist.displayName,
              },
              heroImage: null,
            },
            ownerWallet: wallet,
            assetAddress: art.chain.coreAssetAddress,
            ownershipSource: "INDEXED_CORE",
            custody: {
              state: "KATHA_HELD",
              source: "FINALIZED_REGISTRY",
              observedAt: art.ownership.observedAt,
            },
            indexing: { ...provenanceFixture.indexing, status: "LAGGING" },
          },
        ],
    pagination: { limit: 20, offset, hasMore: offset === 0 },
  });
}
export function collectionListingFixture(
  wallet = "11111111111111111111111111111112",
): ArtworkListingResponse {
  return {
    kathaId: art.kathaId,
    cluster: "localnet",
    commitment: "finalized",
    observedSlot: "2",
    chainTime: "1800000000",
    owner: wallet,
    asset: art.chain.coreAssetAddress!,
    currentRevision: "1",
    listing: null,
  };
}
