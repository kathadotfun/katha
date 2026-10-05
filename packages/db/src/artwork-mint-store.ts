import { and, eq, ne, or, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { loadArtworkRegistrationSnapshot } from "./artwork-registration-store.js";
import { conditionReports } from "./schema/artwork-attestations.js";
import { blockchainOperations } from "./schema/blockchain-operations.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function snapshot(
  tx: Transaction,
  kathaId: string,
  reportId: string,
  cluster: "LOCALNET" | "DEVNET",
) {
  const base = await loadArtworkRegistrationSnapshot(tx, kathaId, cluster);
  if (!base) return null;
  const [initialReport] = await tx
    .select()
    .from(conditionReports)
    .where(
      and(
        eq(conditionReports.artworkId, base.artwork.id),
        eq(conditionReports.id, reportId),
      ),
    )
    .for("share");
  return { ...base, initialReport: initialReport ?? null };
}
export type ArtworkMintSnapshot = NonNullable<Awaited<ReturnType<typeof snapshot>>>;
export function createArtworkMintStore(db: Database, cluster: "LOCALNET" | "DEVNET") {
  return {
    load: (kathaId: string, reportId: string) =>
      db.transaction((tx) => snapshot(tx, kathaId, reportId, cluster)),
    operations(
      expected: ArtworkMintSnapshot,
      walletId: string,
      idempotencyKey: string,
    ) {
      return createOperationPreparationStore(db, async (tx) => {
        // Serialize missing mint-operation rows across wallets/keys without upgrading parent SHARE locks.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`katha-mint:${cluster}:${expected.artwork.id}`}, 0))`,
        );
        const [competing] = await tx
          .select({ id: blockchainOperations.id })
          .from(blockchainOperations)
          .where(
            and(
              eq(blockchainOperations.artworkId, expected.artwork.id),
              eq(blockchainOperations.cluster, cluster),
              eq(blockchainOperations.kind, "MINT_ARTWORK"),
              ne(blockchainOperations.status, "FAILED"),
              or(
                ne(blockchainOperations.walletId, walletId),
                ne(blockchainOperations.idempotencyKey, idempotencyKey),
              ),
            ),
          )
          .limit(1);
        if (competing) return false;
        const current = await snapshot(
          tx,
          expected.artwork.kathaId,
          expected.initialReport?.id ?? "00000000-0000-4000-8000-000000000000",
          cluster,
        );
        return (
          current !== null &&
          current.artwork.publishedAt === null &&
          current.artist?.verificationStatus === "VERIFIED" &&
          current.artwork.updatedAt.toISOString() ===
            expected.artwork.updatedAt.toISOString() &&
          current.artwork.artistId === expected.artwork.artistId &&
          current.artwork.creatorWallet === expected.artwork.creatorWallet &&
          current.artwork.creationYear === expected.artwork.creationYear &&
          current.artwork.authorshipEvidenceHash ===
            expected.artwork.authorshipEvidenceHash &&
          current.metadata !== null &&
          current.metadata.status !== "DRAFT" &&
          current.metadata.id === expected.metadata?.id &&
          current.metadata.documentHash === expected.metadata.documentHash &&
          current.metadata.uri === expected.metadata.uri &&
          current.metadata.canonicalDocument === expected.metadata.canonicalDocument &&
          current.initialReport !== null &&
          current.initialReport.status !== "DRAFT" &&
          current.initialReport.documentHash === expected.initialReport?.documentHash &&
          current.initialReport.canonicalDocument ===
            expected.initialReport?.canonicalDocument
        );
      });
    },
  };
}
export type ArtworkMintStore = ReturnType<typeof createArtworkMintStore>;
