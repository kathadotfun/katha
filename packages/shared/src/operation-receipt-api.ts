import { z } from "zod";
import { chainOperationKindSchema } from "./blockchain-operation.js";
import { walletClusterSchema } from "./wallet-session.js";
import { tokenAmountSchema } from "./marketplace.js";
export const operationReceiptParamsSchema = z.strictObject({
  operationId: z.uuid().transform((v) => v.toLowerCase()),
});
export const operationReceiptRequestSchema = z.strictObject({
  preparationId: z.uuid().transform((v) => v.toLowerCase()),
  transactionBase64: z
    .string()
    .min(4)
    .max(5464)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
});
export const operationReceiptResponseSchema = z
  .strictObject({
    receiptId: z.uuid(),
    operationId: z.uuid(),
    preparationId: z.uuid(),
    kind: chainOperationKindSchema,
    cluster: walletClusterSchema,
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
    messageHash: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["UNKNOWN", "FAILED", "FINALIZED"]),
    operationStatus: z.enum(["PREPARED", "UNKNOWN", "FAILED", "FINALIZED"]),
    failureCode: z.enum(["TRANSACTION_FAILED", "BLOCKHASH_EXPIRED"]).nullable(),
    slot: tokenAmountSchema.nullable(),
    chainRecordedAt: z.iso.datetime({ precision: 3 }).nullable(),
  })
  .refine((v) =>
    v.status === "FINALIZED"
      ? v.slot !== null && v.chainRecordedAt !== null && v.failureCode === null
      : v.slot === null &&
        v.chainRecordedAt === null &&
        (v.status === "FAILED" ? v.failureCode !== null : v.failureCode === null),
  );
