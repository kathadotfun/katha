import {
  artworkMetadataVersions,
  verifications,
  conditionReports,
} from "./schema/artwork-attestations.js";
import { custodyEvents } from "./schema/custody-fulfillment.js";
import { blockchainOperations } from "./schema/blockchain-operations.js";
import { artworkOwnership, indexedEvents } from "./schema/blockchain-read-models.js";
import { artworkMaterials } from "./schema/artwork-materials.js";
import { eq, sql, desc, asc, isNull } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artists } from "./schema/artists.js";
import {
  artworks,
  type NewArtworkRecord,
  type ArtworkRecord,
} from "./schema/artworks.js";

type DraftCreation = Pick<
  NewArtworkRecord,
  | "artistId"
  | "category"
  | "title"
  | "creationYear"
  | "authorshipEvidenceHash"
  | "heightMm"
  | "widthMm"
  | "depthMm"
  | "originCountryCode"
  | "originRegion"
  | "originLocality"
  | "technique"
  | "story"
  | "meaning"
  | "culturalContext"
  | "creationProcess"
> & { creationRequestId: string; materials?: string[] | undefined };
type CreationResult =
  | { status: "created"; record: ArtworkRecord; materials?: string[] | undefined }
  | { status: "artist_not_found" | "duplicate" | "capacity_exhausted" };
type EditableDraft = Pick<
  NewArtworkRecord,
  | "title"
  | "authorshipEvidenceHash"
  | "heightMm"
  | "widthMm"
  | "depthMm"
  | "originCountryCode"
  | "originRegion"
  | "originLocality"
  | "technique"
  | "story"
  | "meaning"
  | "culturalContext"
  | "creationProcess"
>;
type DraftChanges = { [K in keyof EditableDraft]?: EditableDraft[K] | undefined } & {
  materials?: string[] | undefined;
};
type UpdateResult =
  | { status: "updated"; record: ArtworkRecord; materials?: string[] | undefined }
  | { status: "not_found" | "conflict" };
// The draft list and editor use the same conservative workflow boundary. Even
// a prepared/failed operation freezes basic edits; this is not chain success.
export function lifecycleStarted(artworkId: string | typeof artworks.id) {
  return sql<boolean>`
    EXISTS (SELECT 1 FROM ${artworkMetadataVersions} WHERE ${artworkMetadataVersions.artworkId} = ${artworkId}) OR
    EXISTS (SELECT 1 FROM ${verifications} WHERE ${verifications.artworkId} = ${artworkId}) OR
    EXISTS (SELECT 1 FROM ${conditionReports} WHERE ${conditionReports.artworkId} = ${artworkId}) OR
    EXISTS (SELECT 1 FROM ${custodyEvents} WHERE ${custodyEvents.artworkId} = ${artworkId}) OR
    EXISTS (SELECT 1 FROM ${blockchainOperations} WHERE ${blockchainOperations.artworkId} = ${artworkId}) OR
    EXISTS (SELECT 1 FROM ${artworkOwnership} WHERE ${artworkOwnership.artworkId} = ${artworkId}) OR
    EXISTS (SELECT 1 FROM ${indexedEvents} WHERE ${indexedEvents.artworkId} = ${artworkId})
  `;
}
class DuplicateDraft extends Error {}
export function createArtworkDraftStore(db: Database) {
  return {
    async read(kathaId: string) {
      return db.transaction(async (tx) => {
        // Share lock keeps parent content and materials consistent with our writers.
        // Eligibility is a read hint; the update lock rechecks concurrent lifecycle inserts.
        const [record] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId))
          .for("share");
        if (!record) return null;
        const [state] = await tx
          .select({ frozen: lifecycleStarted(record.id) })
          .from(artworks)
          .where(eq(artworks.id, record.id));
        const materials = await tx
          .select({ name: artworkMaterials.name })
          .from(artworkMaterials)
          .where(eq(artworkMaterials.artworkId, record.id))
          .orderBy(asc(artworkMaterials.position));
        return {
          record,
          materials: materials.map((row) => row.name),
          editable: record.publishedAt === null && state?.frozen === false,
        };
      });
    },
    async list(page: { limit: number; offset: number }) {
      return db
        .select({
          id: artworks.id,
          kathaId: artworks.kathaId,
          title: artworks.title,
          category: artworks.category,
          creationYear: artworks.creationYear,
          artistId: artists.id,
          artistName: artists.displayName,
          artistVerificationStatus: artists.verificationStatus,
          lifecycleStarted: lifecycleStarted(artworks.id),
          createdAt: artworks.createdAt,
          updatedAt: artworks.updatedAt,
        })
        .from(artworks)
        .innerJoin(artists, eq(artists.id, artworks.artistId))
        .where(isNull(artworks.publishedAt))
        .orderBy(desc(artworks.createdAt), desc(artworks.id))
        .limit(page.limit + 1)
        .offset(page.offset);
    },
    async update(
      kathaId: string,
      expectedUpdatedAt: string,
      changes: DraftChanges,
    ): Promise<UpdateResult> {
      return db.transaction(async (tx) => {
        // FOR UPDATE also serializes new lifecycle rows through their artwork FKs.
        const [record] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId))
          .for("update");
        if (!record) return { status: "not_found" };
        if (
          record.publishedAt !== null ||
          record.updatedAt.toISOString() !== expectedUpdatedAt ||
          (record.authorshipEvidenceHash !== null &&
            changes.authorshipEvidenceHash !== undefined &&
            changes.authorshipEvidenceHash !== record.authorshipEvidenceHash)
        )
          return { status: "conflict" };
        const [state] = await tx
          .select({
            frozen: lifecycleStarted(record.id),
          })
          .from(artworks)
          .where(eq(artworks.id, record.id));
        if (!state || state.frozen) return { status: "conflict" };
        const [updated] = await tx
          .update(artworks)
          .set({
            title: changes.title,
            authorshipEvidenceHash: changes.authorshipEvidenceHash,
            heightMm: changes.heightMm,
            widthMm: changes.widthMm,
            depthMm: changes.depthMm,
            originCountryCode: changes.originCountryCode,
            originRegion: changes.originRegion,
            originLocality: changes.originLocality,
            technique: changes.technique,
            story: changes.story,
            meaning: changes.meaning,
            culturalContext: changes.culturalContext,
            creationProcess: changes.creationProcess,
            // JS serializes milliseconds; ensure even rapid edits get distinct visible tokens.
            updatedAt: sql`greatest(clock_timestamp(), ${artworks.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(artworks.id, record.id))
          .returning();
        if (!updated) throw new Error("Locked draft disappeared");
        if (changes.materials !== undefined) {
          await tx
            .delete(artworkMaterials)
            .where(eq(artworkMaterials.artworkId, record.id));
          if (changes.materials.length)
            await tx.insert(artworkMaterials).values(
              changes.materials.map((name, position) => ({
                artworkId: record.id,
                name,
                position,
              })),
            );
        }
        const materials = await tx
          .select({ name: artworkMaterials.name })
          .from(artworkMaterials)
          .where(eq(artworkMaterials.artworkId, record.id))
          .orderBy(asc(artworkMaterials.position));
        return {
          status: "updated",
          record: updated,
          materials: materials.map((row) => row.name),
        };
      });
    },
    async create(input: DraftCreation): Promise<CreationResult> {
      try {
        return await db.transaction(async (tx) => {
          const [artist] = await tx
            .select({ id: artists.id })
            .from(artists)
            .where(eq(artists.id, input.artistId))
            .for("key share");
          if (!artist) return { status: "artist_not_found" };
          const [record] = await tx
            .insert(artworks)
            .values({
              creationRequestId: input.creationRequestId,
              artistId: input.artistId,
              category: input.category,
              title: input.title,
              creationYear: input.creationYear,
              authorshipEvidenceHash: input.authorshipEvidenceHash,
              heightMm: input.heightMm,
              widthMm: input.widthMm,
              depthMm: input.depthMm,
              originCountryCode: input.originCountryCode,
              originRegion: input.originRegion,
              originLocality: input.originLocality,
              technique: input.technique,
              story: input.story,
              meaning: input.meaning,
              culturalContext: input.culturalContext,
              creationProcess: input.creationProcess,
            })
            .onConflictDoNothing({ target: artworks.creationRequestId })
            .returning();
          // BEFORE INSERT allocation also runs on conflicts; roll it back with the loser.
          if (!record) throw new DuplicateDraft();
          if (input.materials?.length)
            await tx.insert(artworkMaterials).values(
              input.materials.map((name, position) => ({
                artworkId: record.id,
                name,
                position,
              })),
            );
          return { status: "created", record, materials: input.materials ?? [] };
        });
      } catch (error) {
        if (error instanceof DuplicateDraft) return { status: "duplicate" };
        const driver = error instanceof Error ? error.cause : undefined;
        if (
          typeof driver === "object" &&
          driver !== null &&
          "code" in driver &&
          driver.code === "22003" &&
          "constraint_name" in driver &&
          driver.constraint_name === "artwork_id_counters_range"
        )
          return { status: "capacity_exhausted" };
        throw error;
      }
    },
  };
}
export type ArtworkDraftStore = ReturnType<typeof createArtworkDraftStore>;
