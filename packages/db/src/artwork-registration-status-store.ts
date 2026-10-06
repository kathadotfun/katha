import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import {
  blockchainOperations,
  transactionReceipts,
} from "./schema/blockchain-operations.js";
import { indexedEvents } from "./schema/blockchain-read-models.js";
function createArtworkOperationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
  kind: "REGISTER_ARTWORK" | "VERIFY_ARTWORK",
) {
  return async (kathaId: string) =>
    db.transaction(async (tx) => {
      const operations = await tx
        .select({
          id: blockchainOperations.id,
          programAddress: blockchainOperations.programAddress,
          status: blockchainOperations.status,
        })
        .from(blockchainOperations)
        .innerJoin(artworks, eq(artworks.id, blockchainOperations.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(blockchainOperations.cluster, cluster),
            eq(blockchainOperations.kind, kind),
          ),
        )
        .orderBy(desc(blockchainOperations.createdAt), desc(blockchainOperations.id));
      const finalized = operations.find((row) => row.status === "FINALIZED");
      const [{ receipt, programAddress } = {}] = await tx
        .select({
          receipt: transactionReceipts,
          programAddress: blockchainOperations.programAddress,
        })
        .from(transactionReceipts)
        .innerJoin(
          blockchainOperations,
          eq(blockchainOperations.id, transactionReceipts.operationId),
        )
        .innerJoin(artworks, eq(artworks.id, blockchainOperations.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(blockchainOperations.cluster, cluster),
            eq(transactionReceipts.cluster, cluster),
            eq(blockchainOperations.kind, kind),
          ),
        )
        .orderBy(
          sql`case ${transactionReceipts.status} when 'FINALIZED' then 0 when 'UNKNOWN' then 1 else 2 end`,
          desc(transactionReceipts.observedAt),
          desc(transactionReceipts.id),
        )
        .limit(1);
      // A newer unsigned preparation must not hide an older unresolved signed attempt.
      const [unknown] = await tx
        .select({ id: transactionReceipts.id })
        .from(transactionReceipts)
        .innerJoin(
          blockchainOperations,
          eq(blockchainOperations.id, transactionReceipts.operationId),
        )
        .innerJoin(artworks, eq(artworks.id, blockchainOperations.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(blockchainOperations.cluster, cluster),
            eq(transactionReceipts.cluster, cluster),
            eq(blockchainOperations.kind, kind),
            eq(transactionReceipts.status, "UNKNOWN"),
          ),
        )
        .limit(1);
      const [event] =
        receipt?.status === "FINALIZED"
          ? await tx
              .select({ id: indexedEvents.id })
              .from(indexedEvents)
              .innerJoin(artworks, eq(artworks.id, indexedEvents.artworkId))
              .where(
                and(
                  eq(artworks.kathaId, kathaId),
                  eq(indexedEvents.cluster, cluster),
                  eq(indexedEvents.programAddress, programAddress ?? ""),
                  eq(indexedEvents.signature, receipt.signature),
                  eq(indexedEvents.kind, "REGISTRY"),
                ),
              )
              .limit(1)
          : [];
      return {
        finalized: Boolean(finalized) || receipt?.status === "FINALIZED",
        unresolved: Boolean(unknown),
        receipt: receipt
          ? {
              status: receipt.status,
              signature: receipt.signature,
              slot: receipt.slot?.toString() ?? null,
              indexed: Boolean(event),
            }
          : null,
      };
    });
}

export function createArtworkRegistrationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return createArtworkOperationStatusStore(db, cluster, "REGISTER_ARTWORK");
}
export function createArtworkVerificationStatusStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return createArtworkOperationStatusStore(db, cluster, "VERIFY_ARTWORK");
}
