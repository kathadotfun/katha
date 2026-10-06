import { and, eq, isNull, sql } from "drizzle-orm";
import { artists } from "./schema/artists.js";
import { publicationPredicate } from "./public-artwork-store.js";
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

// Public reads never expose draft bindings or administrative audit fields.
export function createNfcResolutionStore(db: Database, cluster: "LOCALNET" | "DEVNET") {
  return {
    async find(tagId: string) {
      const [record] = await db
        .select({
          tagId: nfcTags.tagId,
          kathaId: artworks.kathaId,
          retiredAt: nfcTags.retiredAt,
        })
        .from(nfcTags)
        .innerJoin(artworks, eq(artworks.id, nfcTags.artworkId))
        .innerJoin(artists, eq(artists.id, artworks.artistId))
        .where(and(eq(nfcTags.tagId, tagId), publicationPredicate(cluster)))
        .limit(1);
      return record ?? null;
    },
  };
}
export type NfcResolutionStore = ReturnType<typeof createNfcResolutionStore>;
