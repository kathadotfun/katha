import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artists } from "./schema/artists.js";
import { artworks } from "./schema/artworks.js";
import { artworkMetadataVersions } from "./schema/artwork-attestations.js";
import { blockchainOperations } from "./schema/blockchain-operations.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export async function loadArtworkRegistrationSnapshot(
  tx: Transaction,
  kathaId: string,
  cluster: "LOCALNET" | "DEVNET",
) {
  const [artwork] = await tx
    .select()
    .from(artworks)
    .where(eq(artworks.kathaId, kathaId))
    .for("share");
  if (!artwork) return null;
  const [artist] = await tx
    .select()
    .from(artists)
    .where(eq(artists.id, artwork.artistId))
    .for("share");
  const [metadata] = await tx
    .select()
    .from(artworkMetadataVersions)
    .where(eq(artworkMetadataVersions.artworkId, artwork.id))
    .orderBy(desc(artworkMetadataVersions.version))
    .limit(1)
    .for("share");
  const [registered] = await tx
    .select({ id: blockchainOperations.id })
    .from(blockchainOperations)
    .where(
      and(
        eq(blockchainOperations.artworkId, artwork.id),
        eq(blockchainOperations.cluster, cluster),
        eq(blockchainOperations.kind, "REGISTER_ARTWORK"),
        eq(blockchainOperations.status, "FINALIZED"),
      ),
    )
    .limit(1);
  return {
    artwork,
    artist: artist ?? null,
    metadata: metadata ?? null,
    registered: Boolean(registered),
  };
}
export type ArtworkRegistrationSnapshot = NonNullable<
  Awaited<ReturnType<typeof loadArtworkRegistrationSnapshot>>
>;
export function createArtworkRegistrationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return {
    load: (kathaId: string) =>
      db.transaction((tx) => loadArtworkRegistrationSnapshot(tx, kathaId, cluster)),
    operations(expected: ArtworkRegistrationSnapshot) {
      return createOperationPreparationStore(db, async (tx) => {
        const current = await loadArtworkRegistrationSnapshot(
          tx,
          expected.artwork.kathaId,
          cluster,
        );
        // Recheck eligibility under the save transaction's parent/artist/metadata locks.
        return (
          current !== null &&
          !current.registered &&
          current.artwork.publishedAt === null &&
          current.artwork.id === expected.artwork.id &&
          current.artwork.updatedAt.toISOString() ===
            expected.artwork.updatedAt.toISOString() &&
          current.artwork.artistId === expected.artwork.artistId &&
          current.artwork.category === expected.artwork.category &&
          current.artwork.creationYear === expected.artwork.creationYear &&
          current.artwork.creatorWallet === expected.artwork.creatorWallet &&
          current.artwork.authorshipEvidenceHash ===
            expected.artwork.authorshipEvidenceHash &&
          current.artist?.verificationStatus === "VERIFIED" &&
          current.metadata?.status === "PREPARED" &&
          current.metadata.id === expected.metadata?.id &&
          current.metadata.documentHash === expected.metadata.documentHash &&
          current.metadata.canonicalDocument === expected.metadata.canonicalDocument &&
          current.metadata.uri === expected.metadata.uri
        );
      });
    },
  };
}
export type ArtworkRegistrationStore = ReturnType<
  typeof createArtworkRegistrationStore
>;
