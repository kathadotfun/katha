import { and, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import { loadArtworkRegistrationSnapshot } from "./artwork-registration-store.js";
import { verifications } from "./schema/artwork-attestations.js";
import { blockchainOperations } from "./schema/blockchain-operations.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function snapshot(
  tx: Transaction,
  kathaId: string,
  cluster: "LOCALNET" | "DEVNET",
) {
  const base = await loadArtworkRegistrationSnapshot(tx, kathaId, cluster);
  if (!base) return null;
  const [verification] = await tx
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(
        eq(verifications.artworkId, base.artwork.id),
        eq(verifications.status, "FINALIZED"),
      ),
    )
    .limit(1);
  const [operation] = await tx
    .select({ id: blockchainOperations.id })
    .from(blockchainOperations)
    .where(
      and(
        eq(blockchainOperations.artworkId, base.artwork.id),
        eq(blockchainOperations.cluster, cluster),
        eq(blockchainOperations.kind, "VERIFY_ARTWORK"),
        eq(blockchainOperations.status, "FINALIZED"),
      ),
    )
    .limit(1);
  return { ...base, verified: Boolean(verification || operation) };
}
export type ArtworkVerificationSnapshot = NonNullable<
  Awaited<ReturnType<typeof snapshot>>
>;
export function createArtworkVerificationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return {
    load: (kathaId: string) => db.transaction((tx) => snapshot(tx, kathaId, cluster)),
    operations(expected: ArtworkVerificationSnapshot) {
      return createOperationPreparationStore(db, async (tx) => {
        const current = await snapshot(tx, expected.artwork.kathaId, cluster);
        // The parent lock also serializes document writers. No chain/storage I/O here.
        return (
          current !== null &&
          !current.verified &&
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
          current.metadata !== null &&
          current.metadata.status !== "DRAFT" &&
          current.metadata.status === expected.metadata?.status &&
          current.metadata.id === expected.metadata.id &&
          current.metadata.version === expected.metadata.version &&
          current.metadata.documentHash === expected.metadata.documentHash &&
          current.metadata.canonicalDocument === expected.metadata.canonicalDocument &&
          current.metadata.uri === expected.metadata.uri
        );
      });
    },
  };
}
export type ArtworkVerificationStore = ReturnType<
  typeof createArtworkVerificationStore
>;
