import { and, asc, ne, desc, eq } from "drizzle-orm";
import { unresolvedCondition } from "./condition-write-guard.js";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artists } from "./schema/artists.js";
import { artworkMedia } from "./schema/artwork-media.js";
import { artworkMaterials } from "./schema/artwork-materials.js";
import {
  artworkMetadataVersions,
  conditionReports,
} from "./schema/artwork-attestations.js";

type Snapshot = {
  artwork: typeof artworks.$inferSelect;
  artist: typeof artists.$inferSelect;
  media: (typeof artworkMedia.$inferSelect)[];
  materials: (typeof artworkMaterials.$inferSelect)[];
};
type Prepared = { canonicalDocument: string; documentHash: string; uri: string | null };
type Condition = Pick<
  typeof conditionReports.$inferInsert,
  | "id"
  | "inspectorId"
  | "grade"
  | "reason"
  | "inspectedAt"
  | "reportedAt"
  | "notes"
  | "mediaHashes"
  | "ownerWallet"
  | "custodyRevision"
>;
export function createDocumentPreparationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET" = "LOCALNET",
) {
  return {
    async prepare(
      kathaId: string,
      expectedUpdatedAt: string,
      authorityWallet: string,
      kind: "METADATA" | "CONDITION",
      build: (snapshot: Snapshot) => Promise<Prepared & { condition?: Condition }>,
    ) {
      return db.transaction(async (tx) => {
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId))
          .for("update");
        if (!artwork) return { status: "not_found" as const };
        if (artwork.updatedAt.toISOString() !== expectedUpdatedAt)
          return { status: "conflict" as const };
        if (kind === "CONDITION") {
          const [pending] = await tx
            .select({ blocked: unresolvedCondition(artwork.id, cluster) })
            .from(artworks)
            .where(eq(artworks.id, artwork.id));
          if (pending?.blocked) return { status: "conflict" as const };
        }
        const [artist] = await tx
          .select()
          .from(artists)
          .where(eq(artists.id, artwork.artistId))
          .for("share");
        if (!artist || artist.verificationStatus !== "VERIFIED")
          return { status: "conflict" as const };
        const media = await tx
          .select()
          .from(artworkMedia)
          .where(eq(artworkMedia.artworkId, artwork.id))
          .orderBy(asc(artworkMedia.position))
          .for("share");
        const materials = await tx
          .select()
          .from(artworkMaterials)
          .where(eq(artworkMaterials.artworkId, artwork.id))
          .orderBy(asc(artworkMaterials.position))
          .for("share");
        // All document construction, storage verification and persistence occur under the parent lock.
        const prepared = await build({ artwork, artist, media, materials });
        if (kind === "CONDITION" && prepared.condition?.id) {
          const [existing] = await tx
            .select()
            .from(conditionReports)
            .where(eq(conditionReports.id, prepared.condition.id))
            .limit(1);
          if (existing) {
            if (
              existing.artworkId === artwork.id &&
              existing.status === "PREPARED" &&
              existing.documentHash === prepared.documentHash &&
              existing.authorityWallet === authorityWallet
            )
              return { status: "prepared" as const, record: existing };
            return { status: "conflict" as const };
          }
        }
        const table = kind === "METADATA" ? artworkMetadataVersions : conditionReports;
        const [latest] = await tx
          .select()
          .from(table)
          .where(eq(table.artworkId, artwork.id))
          .orderBy(desc(table.version))
          .limit(1);
        if (
          latest?.status === "PREPARED" &&
          latest.documentHash === prepared.documentHash &&
          latest.authorityWallet === authorityWallet
        )
          return { status: "prepared" as const, record: latest };
        const version = (latest?.version ?? 0) + 1;
        if (version > 4294967295) return { status: "conflict" as const };
        if (kind === "METADATA") {
          const [record] = await tx
            .insert(artworkMetadataVersions)
            .values({
              artworkId: artwork.id,
              version,
              authorityWallet,
              status: "PREPARED",
              canonicalDocument: prepared.canonicalDocument,
              documentHash: prepared.documentHash,
              uri: prepared.uri,
            })
            .returning();
          if (!record) throw new Error("Document persistence failed");
          return { status: "prepared" as const, record };
        }
        if (!prepared.condition) throw new Error("Condition fields missing");
        const [existing] = await tx
          .select()
          .from(conditionReports)
          .where(eq(conditionReports.id, prepared.condition.id!))
          .limit(1);
        if (existing) return { status: "conflict" as const };
        const [record] = await tx
          .insert(conditionReports)
          .values({
            ...prepared.condition,
            artworkId: artwork.id,
            version,
            authorityWallet,
            status: "PREPARED",
            canonicalDocument: prepared.canonicalDocument,
            documentHash: prepared.documentHash,
          })
          .returning();
        if (!record) throw new Error("Document persistence failed");
        return { status: "prepared" as const, record };
      });
    },
  };
}
export type DocumentPreparationStore = ReturnType<
  typeof createDocumentPreparationStore
>;

export function createPublicDocumentStore(db: Database) {
  return {
    async findMetadata(hash: string) {
      const [record] = await db
        .select({
          canonicalDocument: artworkMetadataVersions.canonicalDocument,
          documentHash: artworkMetadataVersions.documentHash,
        })
        .from(artworkMetadataVersions)
        .where(
          and(
            eq(artworkMetadataVersions.documentHash, hash),
            ne(artworkMetadataVersions.status, "DRAFT"),
          ),
        )
        .limit(1);
      return record ?? null;
    },
    async findMedia(storageKey: string) {
      const [record] = await db
        .select({
          storageKey: artworkMedia.storageKey,
          contentHash: artworkMedia.contentHash,
          mimeType: artworkMedia.mimeType,
          byteSize: artworkMedia.byteSize,
          visibility: artworkMedia.visibility,
        })
        .from(artworkMedia)
        .where(
          and(
            eq(artworkMedia.storageKey, storageKey),
            eq(artworkMedia.visibility, "PUBLIC"),
          ),
        )
        .limit(1);
      return record ?? null;
    },
  };
}
export type PublicDocumentStore = ReturnType<typeof createPublicDocumentStore>;
