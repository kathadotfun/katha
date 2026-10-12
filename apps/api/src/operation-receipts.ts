import {
  operationReceiptRequestSchema,
  operationReceiptResponseSchema,
  chainOperationKindSchema,
} from "@katha/shared";
import type { OperationReceiptStore } from "@katha/db";
import {
  validateSignedPreparation,
  ReceiptValidationError,
  type AttemptExpiryReader,
  type OperationReceiptReader,
} from "@katha/solana";
import type { WalletSessionBoundary } from "./wallet-session.js";
import { DomainError } from "./errors.js";
export function createOperationReceipts(
  store: OperationReceiptStore,
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  read: OperationReceiptReader,
  cluster: "localnet" | "devnet",
  expired?: AttemptExpiryReader,
) {
  return {
    async reconcile(bearer: string | undefined, operationId: string, input: unknown) {
      const parsed = operationReceiptRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const session = await sessions.authenticate(bearer);
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const { preparationId, transactionBase64 } = parsed.data;
      const snapshot = await store.load(operationId, preparationId, session.walletId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const { operation, preparation, walletAddress } = snapshot;
      if (
        operation.cluster !== (cluster === "localnet" ? "LOCALNET" : "DEVNET") ||
        walletAddress !== session.walletAddress ||
        !chainOperationKindSchema.safeParse(operation.kind).success
      )
        throw new DomainError("CONFLICT");
      let bound;
      try {
        bound = await validateSignedPreparation(transactionBase64, {
          ...preparation,
          ...operation,
          wallet: walletAddress,
          cluster,
          walletId: session.walletId,
        });
      } catch {
        throw new DomainError("CONFLICT");
      }
      const persist = async (
        observation: Parameters<OperationReceiptStore["save"]>[6],
      ) => {
        const saved = await store.save(
          operationId,
          preparationId,
          session.walletId,
          operation.cluster,
          bound.signature,
          bound.messageHash,
          observation,
        );
        if (saved.status !== "saved") throw new DomainError("CONFLICT");
        return operationReceiptResponseSchema.parse({
          receiptId: saved.receipt.id,
          operationId,
          preparationId,
          kind: operation.kind,
          cluster,
          signature: saved.receipt.signature,
          messageHash: saved.receipt.messageHash,
          status: saved.receipt.status,
          operationStatus: saved.operationStatus,
          failureCode: saved.receipt.failureCode,
          slot: saved.receipt.slot?.toString() ?? null,
          chainRecordedAt: saved.receipt.chainRecordedAt?.toISOString() ?? null,
        });
      };
      // Retain the verified signed attempt before RPC lookup, so outages cannot lose tracking.
      const pending = await persist({ status: "UNKNOWN" });
      if (pending.status !== "UNKNOWN") return pending;
      let observation;
      try {
        observation = await read(bound.signature, transactionBase64);
      } catch (error) {
        if (error instanceof ReceiptValidationError) throw new DomainError("CONFLICT");
        return pending;
      }
      if (observation.status !== "UNKNOWN") return persist(observation);
      // A dropped attempt stays unknown until its blockhash provably can no longer land.
      try {
        if (
          expired &&
          (await expired(bound.signature, preparation.lastValidBlockHeight)) &&
          (await store.expireAttempt(pending.receiptId))
        )
          return persist({ status: "UNKNOWN" });
      } catch {
        /* Any doubt keeps the attempt unknown. */
      }
      return pending;
    },
  };
}
export type OperationReceiptsBoundary = ReturnType<typeof createOperationReceipts>;

// Resolves attempts whose signed bytes the browser no longer holds, e.g. after a reload.
export function createExpiredAttemptResolver(
  store: Pick<OperationReceiptStore, "listUnknownAttempts" | "expireAttempt">,
  expired: AttemptExpiryReader,
  cluster: "localnet" | "devnet",
  limit = 20,
) {
  return async () => {
    const attempts = await store.listUnknownAttempts(
      cluster === "localnet" ? "LOCALNET" : "DEVNET",
      limit,
    );
    let resolved = 0;
    for (const attempt of attempts) {
      try {
        if (
          (await expired(attempt.signature, attempt.lastValidBlockHeight)) &&
          (await store.expireAttempt(attempt.receiptId))
        )
          resolved++;
      } catch {
        /* RPC doubt keeps this attempt unknown until a later sweep. */
      }
    }
    return resolved;
  };
}
