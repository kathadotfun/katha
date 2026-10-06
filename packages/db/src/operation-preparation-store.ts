import { and, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import { wallets } from "./schema/wallet-sessions.js";
import { artworks, type ArtworkRecord } from "./schema/artworks.js";
import {
  blockchainOperations,
  type NewBlockchainOperationRecord,
} from "./schema/blockchain-operations.js";
import {
  operationPreparations,
  type NewOperationPreparation,
} from "./schema/operation-preparations.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type PreparationGuard = (
  tx: Transaction,
  artwork: ArtworkRecord,
  preparation: NewOperationPreparation,
) => Promise<boolean>;
export function createOperationPreparationStore(
  db: Database,
  guard?: PreparationGuard,
) {
  return {
    async save(
      operation: NewBlockchainOperationRecord,
      walletAddress: string,
      kathaId: string,
      preparation: NewOperationPreparation,
    ) {
      return db.transaction(async (tx) => {
        // Wallet-scoped serialization also covers a missing idempotency-key row.
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.id, operation.walletId))
          .for("update");
        if (!wallet || wallet.address !== walletAddress)
          return { status: "conflict" as const };
        const [artwork] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, operation.artworkId))
          .for(operation.kind === "RECORD_CONDITION" ? "update" : "share");
        if (!artwork || artwork.kathaId !== kathaId)
          return { status: "not_found" as const };
        if (guard && !(await guard(tx, artwork, preparation)))
          return { status: "conflict" as const };
        let [record] = await tx
          .select()
          .from(blockchainOperations)
          .where(
            and(
              eq(blockchainOperations.walletId, operation.walletId),
              eq(blockchainOperations.cluster, operation.cluster),
              eq(blockchainOperations.idempotencyKey, operation.idempotencyKey),
            ),
          )
          .for("update");
        if (
          record &&
          (record.status !== "PREPARED" ||
            record.requestHash !== operation.requestHash ||
            record.artworkId !== operation.artworkId ||
            record.kind !== operation.kind ||
            record.programAddress !== operation.programAddress ||
            JSON.stringify(record.expectedAccounts) !==
              JSON.stringify(operation.expectedAccounts) ||
            JSON.stringify(record.expectedHashes) !==
              JSON.stringify(operation.expectedHashes))
        )
          return { status: "conflict" as const };
        if (!record)
          [record] = await tx
            .insert(blockchainOperations)
            .values(operation)
            .returning();
        if (!record) throw new Error("Operation insert failed");
        const [previous] = await tx
          .select()
          .from(operationPreparations)
          .where(
            and(
              eq(operationPreparations.operationId, record.id),
              eq(operationPreparations.messageHash, preparation.messageHash),
            ),
          );
        if (previous) {
          if (
            previous.canonicalRequest !== preparation.canonicalRequest ||
            previous.transactionBase64 !== preparation.transactionBase64 ||
            previous.blockhash !== preparation.blockhash ||
            previous.lastValidBlockHeight !== preparation.lastValidBlockHeight ||
            previous.transactionVersion !== preparation.transactionVersion
          )
            return { status: "conflict" as const };
          return {
            status: "saved" as const,
            operationId: record.id,
            preparationId: previous.id,
          };
        }
        const [saved] = await tx
          .insert(operationPreparations)
          .values({ ...preparation, operationId: record.id })
          .returning({ id: operationPreparations.id });
        if (!saved) throw new Error("Preparation insert failed");
        return {
          status: "saved" as const,
          operationId: record.id,
          preparationId: saved.id,
        };
      });
    },
  };
}
export type OperationPreparationStore = ReturnType<
  typeof createOperationPreparationStore
>;
