import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks, type ArtworkRecord } from "./schema/artworks.js";
import { artists } from "./schema/artists.js";
import { artworkMedia } from "./schema/artwork-media.js";
import {
  verifications,
  artworkMetadataVersions,
  conditionReports,
} from "./schema/artwork-attestations.js";
import { custodyEvents } from "./schema/custody-fulfillment.js";
import { artworkMaterials } from "./schema/artwork-materials.js";
import {
  indexedEvents,
  indexerCheckpoints,
  artworkOwnership,
} from "./schema/blockchain-read-models.js";

// Discovery and detail must use the same publication boundary.
export function publicationPredicate(cluster: "LOCALNET" | "DEVNET") {
  return and(
    isNotNull(artworks.publishedAt),
    sql`${artworks.publishedAt} <= statement_timestamp()`,
    isNotNull(artworks.authorshipEvidenceHash),
    eq(artists.verificationStatus, "VERIFIED"),
    sql`EXISTS (SELECT 1 FROM ${verifications} WHERE ${verifications.artworkId} = ${artworks.id} AND ${verifications.status} = 'FINALIZED' AND ${verifications.chainCluster} = ${cluster})`,
    sql`EXISTS (SELECT 1 FROM ${artworkMetadataVersions} WHERE ${artworkMetadataVersions.artworkId} = ${artworks.id} AND ${artworkMetadataVersions.status} = 'FINALIZED' AND ${artworkMetadataVersions.chainCluster} = ${cluster})`,
    sql`EXISTS (SELECT 1 FROM ${conditionReports} WHERE ${conditionReports.artworkId} = ${artworks.id} AND ${conditionReports.status} = 'FINALIZED' AND ${conditionReports.chainCluster} = ${cluster} AND ${conditionReports.reason} = 'INITIAL_VERIFICATION')`,
    sql`EXISTS (SELECT 1 FROM ${artworkOwnership} WHERE ${artworkOwnership.artworkId} = ${artworks.id} AND ${artworkOwnership.cluster} = ${cluster})`,
  );
}

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
            publicationPredicate(cluster),
            category === undefined ? undefined : eq(artworks.category, category),
          ),
        )
        .orderBy(asc(artworks.kathaId))
        .limit(limit + 1)
        .offset(offset);
    },
  };
}
export type PublicArtworkStore = ReturnType<typeof createPublicArtworkStore>;

export function createPublicArtworkDetailStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return {
    async findByKathaId(kathaId: string) {
      // One read snapshot prevents mixing ownership, documents and content from different revisions.
      return db.transaction(
        async (tx) => {
          const [record] = await tx
            .select({
              id: artworks.id,
              kathaId: artworks.kathaId,
              category: artworks.category,
              title: artworks.title,
              creationYear: artworks.creationYear,
              creatorWallet: artworks.creatorWallet,
              artist: {
                id: artists.id,
                slug: artists.slug,
                displayName: artists.displayName,
              },
              heightMm: artworks.heightMm,
              widthMm: artworks.widthMm,
              depthMm: artworks.depthMm,
              originCountryCode: artworks.originCountryCode,
              originRegion: artworks.originRegion,
              originLocality: artworks.originLocality,
              technique: artworks.technique,
              story: artworks.story,
              meaning: artworks.meaning,
              culturalContext: artworks.culturalContext,
              creationProcess: artworks.creationProcess,
            })
            .from(artworks)
            .innerJoin(artists, eq(artists.id, artworks.artistId))
            .where(and(publicationPredicate(cluster), eq(artworks.kathaId, kathaId)))
            .limit(1);
          if (!record) return null;
          const materials = await tx
            .select({ name: artworkMaterials.name })
            .from(artworkMaterials)
            .where(eq(artworkMaterials.artworkId, record.id))
            .orderBy(asc(artworkMaterials.position));
          const media = await tx
            .select({
              id: artworkMedia.id,
              kind: artworkMedia.kind,
              role: artworkMedia.role,
              position: artworkMedia.position,
              contentHash: artworkMedia.contentHash,
              mimeType: artworkMedia.mimeType,
              altText: artworkMedia.altText,
            })
            .from(artworkMedia)
            .where(
              and(
                eq(artworkMedia.artworkId, record.id),
                eq(artworkMedia.visibility, "PUBLIC"),
              ),
            )
            .orderBy(asc(artworkMedia.position));
          const [verification] = await tx
            .select({
              authorityWallet: verifications.authorityWallet,
              inspectedAt: verifications.inspectedAt,
              documentHash: verifications.documentHash,
              chainSignature: verifications.chainSignature,
              chainSlot: verifications.chainSlot,
              chainRecordedAt: verifications.chainRecordedAt,
            })
            .from(verifications)
            .where(
              and(
                eq(verifications.artworkId, record.id),
                eq(verifications.status, "FINALIZED"),
                eq(verifications.chainCluster, cluster),
              ),
            )
            .orderBy(desc(verifications.chainSlot), desc(verifications.id))
            .limit(1);
          const [metadata] = await tx
            .select({
              version: artworkMetadataVersions.chainVersion,
              uri: artworkMetadataVersions.uri,
              documentHash: artworkMetadataVersions.documentHash,
              chainSignature: artworkMetadataVersions.chainSignature,
              chainSlot: artworkMetadataVersions.chainSlot,
              chainRecordedAt: artworkMetadataVersions.chainRecordedAt,
            })
            .from(artworkMetadataVersions)
            .where(
              and(
                eq(artworkMetadataVersions.artworkId, record.id),
                eq(artworkMetadataVersions.status, "FINALIZED"),
                eq(artworkMetadataVersions.chainCluster, cluster),
              ),
            )
            .orderBy(desc(artworkMetadataVersions.chainVersion))
            .limit(1);
          const [condition] = await tx
            .select({
              version: conditionReports.chainVersion,
              grade: conditionReports.grade,
              reason: conditionReports.reason,
              inspectedAt: conditionReports.inspectedAt,
              authorityWallet: conditionReports.authorityWallet,
              documentHash: conditionReports.documentHash,
              chainSignature: conditionReports.chainSignature,
              chainSlot: conditionReports.chainSlot,
              chainRecordedAt: conditionReports.chainRecordedAt,
            })
            .from(conditionReports)
            .where(
              and(
                eq(conditionReports.artworkId, record.id),
                eq(conditionReports.status, "FINALIZED"),
                eq(conditionReports.chainCluster, cluster),
              ),
            )
            .orderBy(desc(conditionReports.chainVersion))
            .limit(1);
          const [custody] = await tx
            .select({
              state: custodyEvents.toState,
              occurredAt: custodyEvents.occurredAt,
            })
            .from(custodyEvents)
            .where(eq(custodyEvents.artworkId, record.id))
            .orderBy(desc(custodyEvents.revision))
            .limit(1);
          const [ownership] = await tx
            .select({
              ownerWallet: artworkOwnership.ownerWallet,
              assetAddress: artworkOwnership.assetAddress,
              signature: indexedEvents.signature,
              slot: indexedEvents.slot,
              programAddress: indexedEvents.programAddress,
              chainRecordedAt: indexedEvents.chainRecordedAt,
              indexedAt: indexedEvents.indexedAt,
            })
            .from(artworkOwnership)
            .innerJoin(
              indexedEvents,
              and(
                eq(indexedEvents.id, artworkOwnership.sourceEventId),
                eq(indexedEvents.cluster, artworkOwnership.cluster),
                eq(indexedEvents.artworkId, artworkOwnership.artworkId),
              ),
            )
            .where(
              and(
                eq(artworkOwnership.artworkId, record.id),
                eq(artworkOwnership.cluster, cluster),
              ),
            )
            .limit(1);
          if (!verification || !metadata || !condition || !ownership) return null;
          const [checkpoint] = await tx
            .select({
              programAddress: indexerCheckpoints.programAddress,
              scannedThroughSlot: indexerCheckpoints.scannedThroughSlot,
              gapFromSlot: indexerCheckpoints.gapFromSlot,
              gapThroughSlot: indexerCheckpoints.gapThroughSlot,
              updatedAt: indexerCheckpoints.updatedAt,
            })
            .from(indexerCheckpoints)
            .where(
              and(
                eq(indexerCheckpoints.cluster, cluster),
                eq(indexerCheckpoints.programAddress, ownership.programAddress),
              ),
            )
            .limit(1);
          return {
            ...record,
            materials,
            media,
            verification,
            metadata,
            condition,
            custody: custody ?? null,
            ownership,
            checkpoint: checkpoint ?? null,
            cluster,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
export type PublicArtworkDetailStore = ReturnType<
  typeof createPublicArtworkDetailStore
>;
