import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks, type ArtworkRecord } from "./schema/artworks.js";
import { artists } from "./schema/artists.js";
import { artworkMedia } from "./schema/artwork-media.js";
import {
  verifications,
  artworkMetadataVersions,
  conditionReports,
} from "./schema/artwork-attestations.js";
import { artworkOwnership } from "./schema/blockchain-read-models.js";

type DiscoveryQuery = {
  limit: number;
  offset: number;
  category?: ArtworkRecord["category"] | undefined;
};
export function createPublicArtworkStore(db: Database, cluster: "LOCALNET" | "DEVNET") {
  return {
    async list({ limit, offset, category }: DiscoveryQuery) {
      return db
        .select({
          kathaId: artworks.kathaId,
          category: artworks.category,
          title: artworks.title,
          creationYear: artworks.creationYear,
          artist: {
            id: artists.id,
            slug: artists.slug,
            displayName: artists.displayName,
          },
          // Provider paths, private media and inspection details never enter this selection.
          heroImage: {
            id: artworkMedia.id,
            contentHash: artworkMedia.contentHash,
            altText: artworkMedia.altText,
          },
        })
        .from(artworks)
        .innerJoin(artists, eq(artists.id, artworks.artistId))
        .leftJoin(
          artworkMedia,
          and(
            eq(artworkMedia.artworkId, artworks.id),
            eq(artworkMedia.role, "HERO"),
            eq(artworkMedia.kind, "IMAGE"),
            eq(artworkMedia.visibility, "PUBLIC"),
          ),
        )
        .where(
          and(
            isNotNull(artworks.publishedAt),
            sql`${artworks.publishedAt} <= statement_timestamp()`,
            isNotNull(artworks.authorshipEvidenceHash),
            eq(artists.verificationStatus, "VERIFIED"),
            category === undefined ? undefined : eq(artworks.category, category),
            sql`EXISTS (SELECT 1 FROM ${verifications} WHERE ${verifications.artworkId} = ${artworks.id} AND ${verifications.status} = 'FINALIZED' AND ${verifications.chainCluster} = ${cluster})`,
            sql`EXISTS (SELECT 1 FROM ${artworkMetadataVersions} WHERE ${artworkMetadataVersions.artworkId} = ${artworks.id} AND ${artworkMetadataVersions.status} = 'FINALIZED' AND ${artworkMetadataVersions.chainCluster} = ${cluster})`,
            sql`EXISTS (SELECT 1 FROM ${conditionReports} WHERE ${conditionReports.artworkId} = ${artworks.id} AND ${conditionReports.status} = 'FINALIZED' AND ${conditionReports.chainCluster} = ${cluster} AND ${conditionReports.reason} = 'INITIAL_VERIFICATION')`,
            sql`EXISTS (SELECT 1 FROM ${artworkOwnership} WHERE ${artworkOwnership.artworkId} = ${artworks.id} AND ${artworkOwnership.cluster} = ${cluster})`,
          ),
        )
        .orderBy(asc(artworks.kathaId))
        .limit(limit + 1)
        .offset(offset);
    },
  };
}
export type PublicArtworkStore = ReturnType<typeof createPublicArtworkStore>;
