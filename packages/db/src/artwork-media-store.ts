import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artworkMedia, type ArtworkMediaRecord } from "./schema/artwork-media.js";
import { lifecycleStarted } from "./artwork-draft-store.js";
type Content = Pick<
  ArtworkMediaRecord,
  | "role"
  | "visibility"
  | "altText"
  | "caption"
  | "kind"
  | "mimeType"
  | "byteSize"
  | "contentHash"
  | "storageKey"
>;
type Snapshot = {
  artwork: typeof artworks.$inferSelect;
  items: ArtworkMediaRecord[];
  editable: boolean;
};
export class MediaStoreConflict extends Error {}
export function createArtworkMediaStore(db: Database) {
  return {
    async read(kathaId: string) {
      return db.transaction(async (tx): Promise<Snapshot | null> => {
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId))
          .for("share");
        if (!artwork) return null;
        const [state] = await tx
          .select({ frozen: lifecycleStarted(artwork.id) })
          .from(artworks)
          .where(eq(artworks.id, artwork.id));
        const items = await tx
          .select()
          .from(artworkMedia)
          .where(eq(artworkMedia.artworkId, artwork.id))
          .orderBy(asc(artworkMedia.position));
        return {
          artwork,
          items,
          editable: artwork.publishedAt === null && state?.frozen === false,
        };
      });
    },
    async write(
      kathaId: string,
      expectedUpdatedAt: string,
      build: (items: ArtworkMediaRecord[]) => Promise<(Content & { id?: string })[]>,
    ) {
      return db.transaction(async (tx): Promise<Snapshot | null> => {
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId))
          .for("update");
        if (!artwork) return null;
        const [state] = await tx
          .select({ frozen: lifecycleStarted(artwork.id) })
          .from(artworks)
          .where(eq(artworks.id, artwork.id));
        if (
          artwork.publishedAt !== null ||
          state?.frozen !== false ||
          artwork.updatedAt.toISOString() !== expectedUpdatedAt
        )
          throw new MediaStoreConflict();
        const existing = await tx
          .select()
          .from(artworkMedia)
          .where(eq(artworkMedia.artworkId, artwork.id))
          .orderBy(asc(artworkMedia.position));
        const values = await build(existing);
        if (
          values.length > 20 ||
          values.length < existing.length ||
          existing.some((item) => !values.some((value) => value.id === item.id))
        )
          throw new MediaStoreConflict();
        // Unique position/hero constraints require vacating current slots before swaps.
        await tx
          .update(artworkMedia)
          .set({ position: sql`${artworkMedia.position} + 20`, role: "OTHER" })
          .where(eq(artworkMedia.artworkId, artwork.id));
        for (const [position, value] of values.entries()) {
          const { id, ...content } = value;
          if (id) {
            if (!existing.some((item) => item.id === id))
              throw new MediaStoreConflict();
            await tx
              .update(artworkMedia)
              .set({
                ...content,
                position,
                updatedAt: sql`greatest(clock_timestamp(), ${artworkMedia.updatedAt} + interval '1 millisecond')`,
              })
              .where(eq(artworkMedia.id, id));
          } else
            await tx
              .insert(artworkMedia)
              .values({ ...content, artworkId: artwork.id, position });
        }
        const [updated] = await tx
          .update(artworks)
          .set({
            updatedAt: sql`greatest(clock_timestamp(), ${artworks.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(artworks.id, artwork.id))
          .returning();
        if (!updated) throw new MediaStoreConflict();
        const items = await tx
          .select()
          .from(artworkMedia)
          .where(eq(artworkMedia.artworkId, artwork.id))
          .orderBy(asc(artworkMedia.position));
        return { artwork: updated, items, editable: true };
      });
    },
  };
}
export type ArtworkMediaStore = ReturnType<typeof createArtworkMediaStore>;
