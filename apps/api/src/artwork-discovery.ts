import type { PublicArtworkStore } from "@katha/db";
import {
  artworkDiscoveryResponseSchema,
  type ArtworkDiscoveryQuery,
} from "@katha/shared";

export function createArtworkDiscovery(store: PublicArtworkStore) {
  return {
    async list(query: ArtworkDiscoveryQuery) {
      const records = await store.list(query);
      // Explicit projection also protects against future private columns on storage results.
      return artworkDiscoveryResponseSchema.parse({
        items: records.slice(0, query.limit).map((record) => ({
          kathaId: record.kathaId,
          category: record.category,
          title: record.title,
          creationYear: record.creationYear,
          artist: {
            id: record.artist.id,
            slug: record.artist.slug,
            displayName: record.artist.displayName,
          },
          heroImage:
            record.heroImage === null
              ? null
              : {
                  id: record.heroImage.id,
                  contentHash: record.heroImage.contentHash,
                  mimeType: record.heroImage.mimeType,
                  altText: record.heroImage.altText,
                },
        })),
        pagination: {
          limit: query.limit,
          offset: query.offset,
          hasMore: records.length > query.limit,
        },
      });
    },
  };
}
export type ArtworkDiscoveryBoundary = ReturnType<typeof createArtworkDiscovery>;
