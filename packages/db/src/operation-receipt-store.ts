import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import {
  blockchainOperations,
  transactionReceipts,
} from "./schema/blockchain-operations.js";
import { operationPreparations } from "./schema/operation-preparations.js";
import { wallets } from "./schema/wallet-sessions.js";
export type ReceiptStoreObservation =
  | { status: "UNKNOWN" }
  | { status: "FAILED"; failureCode: "TRANSACTION_FAILED" }
  | { status: "FINALIZED"; slot: bigint; chainRecordedAt: Date };
export function createOperationReceiptStore(db: Database) {
  return {
    async load(operationId: string, preparationId: string, walletId: string) {
      const [snapshot] = await db
        .select({
          operation: blockchainOperations,
          preparation: operationPreparations,
          walletAddress: wallets.address,
        })
        .from(blockchainOperations)
        .innerJoin(
          operationPreparations,
          eq(operationPreparations.operationId, blockchainOperations.id),
        )
        .innerJoin(wallets, eq(wallets.id, blockchainOperations.walletId))
        .where(
          and(
            eq(blockchainOperations.id, operationId),
            eq(operationPreparations.id, preparationId),
            eq(blockchainOperations.walletId, walletId),
          ),
        );
      return snapshot ?? null;
    },
    async save(
      operationId: string,
      preparationId: string,
      walletId: string,
      cluster: "LOCALNET" | "DEVNET",
      signature: string,
      messageHash: string,
      observation: ReceiptStoreObservation,
    ) {
      return db.transaction(async (tx) => {
        const [operation] = await tx
          .select()
          .from(blockchainOperations)
          .where(
            and(
              eq(blockchainOperations.id, operationId),
              eq(blockchainOperations.walletId, walletId),
              eq(blockchainOperations.cluster, cluster),
            ),
          )
          .for("update");
        if (!operation) return { status: "conflict" as const };
        const [prepared] = await tx
          .select()
          .from(operationPreparations)
          .where(
            and(
              eq(operationPreparations.id, preparationId),
              eq(operationPreparations.operationId, operation.id),
              eq(operationPreparations.messageHash, messageHash),
            ),
          )
          .for("share");
        if (!prepared) return { status: "conflict" as const };
        // Serialize an absent signature row across different parent operations too.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`katha-receipt:${cluster}:${signature}`}, 0))`,
        );
        let [receipt] = await tx
          .select()
          .from(transactionReceipts)
          .where(
            and(
              eq(transactionReceipts.cluster, cluster),
              eq(transactionReceipts.signature, signature),
            ),
          )
          .for("update");
        if (
          receipt &&
          (receipt.operationId !== operationId || receipt.messageHash !== messageHash)
        )
          return { status: "conflict" as const };
        if (!receipt) {
          if (operation.status === "FINALIZED") return { status: "conflict" as const };
          [receipt] = await tx
            .insert(transactionReceipts)
            .values({ operationId, cluster, signature, messageHash })
            .returning();
        }
        if (!receipt) throw new Error("Receipt insert failed");
        if (receipt.status !== "UNKNOWN") {
          if (
            observation.status !== "UNKNOWN" &&
            (observation.status !== receipt.status ||
              (observation.status === "FINALIZED" &&
                (observation.slot !== receipt.slot ||
                  observation.chainRecordedAt.getTime() !==
                    receipt.chainRecordedAt?.getTime())))
          )
            return { status: "conflict" as const };
        } else if (observation.status !== "UNKNOWN") {
          if (observation.status === "FINALIZED" && operation.status === "FINALIZED")
            return { status: "conflict" as const };
          const values =
            observation.status === "FAILED"
              ? { status: "FAILED" as const, failureCode: observation.failureCode }
              : {
                  status: "FINALIZED" as const,
                  slot: observation.slot,
                  chainRecordedAt: observation.chainRecordedAt,
                  finalizedAt: sql`clock_timestamp()`,
                };
          [receipt] = await tx
            .update(transactionReceipts)
            .set(values)
            .where(eq(transactionReceipts.id, receipt.id))
            .returning();
        }
        if (!receipt) throw new Error("Receipt update failed");
        const [current] = await tx
          .select({ status: blockchainOperations.status })
          .from(blockchainOperations)
          .where(eq(blockchainOperations.id, operationId));
        if (!current) throw new Error("Operation missing");
        return { status: "saved" as const, receipt, operationStatus: current.status };
      });
    },
  };
}
export type OperationReceiptStore = ReturnType<typeof createOperationReceiptStore>;
