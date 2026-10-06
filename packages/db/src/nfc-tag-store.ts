import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { nfcTags } from "./schema/nfc-tags.js";

export type NfcTagRecord = typeof nfcTags.$inferSelect & { kathaId: string };
export function createNfcTagStore(db: Database) {
  const selection = {
    tagId: nfcTags.tagId,
    artworkId: nfcTags.artworkId,
    assignedByWalletId: nfcTags.assignedByWalletId,
    assignedAt: nfcTags.assignedAt,
    retiredAt: nfcTags.retiredAt,
    retiredByWalletId: nfcTags.retiredByWalletId,
    kathaId: artworks.kathaId,
  };
  return {
    async get(tagId: string): Promise<NfcTagRecord | null> {
      const [record] = await db
        .select(selection)
        .from(nfcTags)
        .innerJoin(artworks, eq(artworks.id, nfcTags.artworkId))
        .where(eq(nfcTags.tagId, tagId));
      return record ?? null;
    },
    async assign(
      kathaId: string,
      tagId: string,
      walletId: string,
    ): Promise<
      | { status: "assigned"; record: NfcTagRecord }
      | { status: "not_found" | "conflict" }
    > {
      return db.transaction(async (tx) => {
        const [artwork] = await tx
          .select({ id: artworks.id })
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId));
        if (!artwork) return { status: "not_found" };
        await tx
          .insert(nfcTags)
          .values({ tagId, artworkId: artwork.id, assignedByWalletId: walletId })
          .onConflictDoNothing();
        const [record] = await tx
          .select(selection)
          .from(nfcTags)
          .innerJoin(artworks, eq(artworks.id, nfcTags.artworkId))
          .where(eq(nfcTags.tagId, tagId));
        if (!record || record.artworkId !== artwork.id || record.retiredAt !== null)
          return { status: "conflict" };
        return { status: "assigned", record };
      });
    },
    async retire(tagId: string, walletId: string): Promise<NfcTagRecord | null> {
      return db.transaction(async (tx) => {
        await tx
          .update(nfcTags)
          .set({ retiredAt: sql`now()`, retiredByWalletId: walletId })
          .where(and(eq(nfcTags.tagId, tagId), isNull(nfcTags.retiredAt)));
        const [record] = await tx
          .select(selection)
          .from(nfcTags)
          .innerJoin(artworks, eq(artworks.id, nfcTags.artworkId))
          .where(eq(nfcTags.tagId, tagId));
        return record ?? null;
      });
    },
  };
}
export type NfcTagStore = ReturnType<typeof createNfcTagStore>;
