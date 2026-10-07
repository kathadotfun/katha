import { eq } from "drizzle-orm";
import { artworks } from "./schema/artworks.js";
import { unresolvedMetadata } from "./metadata-write-guard.js";
import type { Database } from "./connection.js";
import {
  loadArtworkRegistrationSnapshot,
  type ArtworkRegistrationSnapshot,
} from "./artwork-registration-store.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";

export function createMetadataRevisionStore(
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
        if (current) {
          const [guard] = await tx
            .select({ blocked: unresolvedMetadata(current.artwork.id, cluster) })
            .from(artworks)
            .where(eq(artworks.id, current.artwork.id));
          if (guard?.blocked) return false;
        }
        return (
          current !== null &&
          current.artist?.verificationStatus === "VERIFIED" &&
          current.artwork.id === expected.artwork.id &&
          current.artwork.updatedAt.toISOString() ===
            expected.artwork.updatedAt.toISOString() &&
          current.artwork.publishedAt?.toISOString() ===
            expected.artwork.publishedAt?.toISOString() &&
          current.artwork.artistId === expected.artwork.artistId &&
          current.artwork.category === expected.artwork.category &&
          current.artwork.creatorWallet === expected.artwork.creatorWallet &&
          current.artwork.creationYear === expected.artwork.creationYear &&
          current.artwork.authorshipEvidenceHash ===
            expected.artwork.authorshipEvidenceHash &&
          current.metadata?.status === "PREPARED" &&
          current.metadata.id === expected.metadata?.id &&
          current.metadata.documentHash === expected.metadata.documentHash &&
          current.metadata.uri === expected.metadata.uri &&
          current.metadata.canonicalDocument === expected.metadata.canonicalDocument
        );
      });
    },
  };
}
export type MetadataRevisionStore = ReturnType<typeof createMetadataRevisionStore>;
