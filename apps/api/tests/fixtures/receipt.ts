import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { OperationReceiptStore } from "@katha/db";
import type {
  AttemptExpiryReader,
  OperationReceiptReader,
  ReceiptObservation,
} from "@katha/solana";
import { registrationFixture } from "./registration.js";
import { createOperationReceipts } from "../../src/operation-receipts.js";
import { DomainError } from "../../src/errors.js";
export async function receiptFixture() {
  const f = await registrationFixture();
  const response = await f.service.prepare(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.request,
  );
  const [operation, , , preparation] = f.save.mock.calls[0]!;
  const signed = Buffer.from(preparation.transactionBase64, "base64");
  if (signed[0] !== 1) throw new Error("Fixture requires one signature");
  f.testWallet.signBytes(signed.subarray(65)).copy(signed, 1);
  const request = {
    preparationId: response.preparationId,
    transactionBase64: signed.toString("base64"),
  };
  const at = new Date("2026-10-05T00:00:00.000Z");
  const snapshot: NonNullable<Awaited<ReturnType<OperationReceiptStore["load"]>>> = {
    operation: {
      ...operation,
      id: response.operationId,
      status: "PREPARED",
      createdAt: at,
      updatedAt: at,
    },
    preparation: {
      ...preparation,
      simulationUnits: preparation.simulationUnits ?? null,
      id: response.preparationId,
      operationId: response.operationId,
      createdAt: at,
    },
    walletAddress: f.session.walletAddress,
  };
  const load = vi.fn<OperationReceiptStore["load"]>(async () => snapshot);
  let receipt:
    | Extract<
        Awaited<ReturnType<OperationReceiptStore["save"]>>,
        { status: "saved" }
      >["receipt"]
    | null = null;
  const save = vi.fn<OperationReceiptStore["save"]>(async (...args) => {
    const [operationId, , , cluster, signature, messageHash, observation] = args;
    receipt ??= {
      id: randomUUID(),
      operationId,
      cluster,
      signature,
      messageHash,
      status: "UNKNOWN",
      failureCode: null,
      slot: null,
      chainRecordedAt: null,
      finalizedAt: null,
      createdAt: at,
      observedAt: at,
    };
    if (receipt.status === "UNKNOWN" && observation.status !== "UNKNOWN")
      receipt =
        observation.status === "FAILED"
          ? { ...receipt, status: "FAILED", failureCode: observation.failureCode }
          : {
              ...receipt,
              status: "FINALIZED",
              slot: observation.slot,
              chainRecordedAt: observation.chainRecordedAt,
              finalizedAt: at,
            };
    return { status: "saved", receipt, operationStatus: receipt.status };
  });
  const authenticate = vi.fn(async (bearer: string | undefined) => {
    if (!bearer) throw new DomainError("UNAUTHENTICATED");
    return f.session;
  });
  const read = vi.fn<OperationReceiptReader>(async (): Promise<ReceiptObservation> => ({
    status: "UNKNOWN",
  }));
  const listUnknownAttempts = vi.fn<OperationReceiptStore["listUnknownAttempts"]>(
    async () =>
      receipt?.status === "UNKNOWN"
        ? [
            {
              receiptId: receipt.id,
              signature: receipt.signature,
              lastValidBlockHeight: snapshot.preparation.lastValidBlockHeight,
            },
          ]
        : [],
  );
  const expireAttempt = vi.fn<OperationReceiptStore["expireAttempt"]>(async (id) => {
    if (receipt?.id !== id || receipt.status !== "UNKNOWN") return false;
    receipt = { ...receipt, status: "FAILED", failureCode: "BLOCKHASH_EXPIRED" };
    return true;
  });
  const expired = vi.fn<AttemptExpiryReader>(async () => false);
  const store: OperationReceiptStore = {
    load,
    save,
    listUnknownAttempts,
    expireAttempt,
  };
  const service = createOperationReceipts(
    store,
    { authenticate },
    read,
    "localnet",
    expired,
  );
  return {
    ...f,
    snapshot,
    response,
    request,
    load,
    save,
    read,
    expired,
    store,
    listUnknownAttempts,
    expireAttempt,
    authenticate,
    service,
  };
}
