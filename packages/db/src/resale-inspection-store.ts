import { and, eq, desc } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { resaleInspectionRequests as requests } from "./schema/resale-inspection-requests.js";
export function createResaleInspectionStore(db: Database) {
  return {
    async load(kathaId: string) {
      return (
        (
          await db.select().from(artworks).where(eq(artworks.kathaId, kathaId)).limit(1)
        )[0] ?? null
      );
    },
    async list(artworkId: string, ownerWallet?: string) {
      return db
        .select()
        .from(requests)
        .where(
          and(
            eq(requests.artworkId, artworkId),
            ownerWallet ? eq(requests.ownerWallet, ownerWallet) : undefined,
          ),
        )
        .orderBy(desc(requests.requestedAt), desc(requests.id))
        .limit(100);
    },
    async request(
      expected: typeof artworks.$inferSelect,
      ownerWallet: string,
      custodyRevision: bigint,
      conditionVersion: number,
      id: string,
    ) {
      return db.transaction(async (tx) => {
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, expected.id))
          .for("update");
        if (
          !artwork ||
          artwork.updatedAt.toISOString() !== expected.updatedAt.toISOString()
        )
          return null;
        const [existingId] = await tx
          .select()
          .from(requests)
          .where(eq(requests.id, id));
        if (
          existingId &&
          (existingId.artworkId !== artwork.id ||
            existingId.ownerWallet !== ownerWallet ||
            existingId.custodyRevision !== custodyRevision ||
            existingId.conditionVersion !== conditionVersion)
        )
          return null;
        await tx
          .insert(requests)
          .values({
            id,
            artworkId: artwork.id,
            ownerWallet,
            custodyRevision,
            conditionVersion,
          })
          .onConflictDoNothing();
        return (
          (
            await tx
              .select()
              .from(requests)
              .where(
                and(
                  eq(requests.artworkId, artwork.id),
                  eq(requests.ownerWallet, ownerWallet),
                  eq(requests.custodyRevision, custodyRevision),
                  eq(requests.conditionVersion, conditionVersion),
                ),
              )
          )[0] ?? null
        );
      });
    },
  };
}
export type ResaleInspectionStore = ReturnType<typeof createResaleInspectionStore>;
