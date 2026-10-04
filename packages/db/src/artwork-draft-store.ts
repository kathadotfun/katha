import { eq } from "drizzle-orm";
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
> & { creationRequestId: string };
type CreationResult =
  | { status: "created"; record: ArtworkRecord }
  | { status: "artist_not_found" | "duplicate" | "capacity_exhausted" };
class DuplicateDraft extends Error {}
export function createArtworkDraftStore(db: Database) {
  return {
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
          return { status: "created", record };
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
