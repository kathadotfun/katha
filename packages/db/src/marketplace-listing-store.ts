import { and, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artists } from "./schema/artists.js";
import { publicationPredicate } from "./public-artwork-store.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";
export function createMarketplaceListingStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  const select = (query: Pick<Database, "select">, kathaId: string) =>
    query
      .select({
        id: artworks.id,
        kathaId: artworks.kathaId,
        artistId: artworks.artistId,
      })
      .from(artworks)
      .innerJoin(artists, eq(artists.id, artworks.artistId))
      .where(and(eq(artworks.kathaId, kathaId), publicationPredicate(cluster)))
      .limit(1);
  const preparation = createOperationPreparationStore(
    db,
    async (tx, artwork) => (await select(tx, artwork.kathaId)).length === 1,
  );
  return {
    async load(kathaId: string) {
      return (await select(db, kathaId))[0] ?? null;
    },
    save: preparation.save,
  };
}
export type MarketplaceListingStore = ReturnType<typeof createMarketplaceListingStore>;
