import { z } from "zod";
import { kathaIdSchema } from "./artwork-identity.js";
import { walletClusterSchema } from "./wallet-session.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { tokenAmountSchema } from "./marketplace.js";
export const resaleInspectionRequestSchema = z.strictObject({
  requestId: z.uuid(),
  expectedConditionVersion: z.number().int().positive().max(4294967294),
  expectedCustodyRevision: tokenAmountSchema,
  inspectionRequested: z.literal(true),
});
export const resaleInspectionRecordSchema = z.strictObject({
  id: z.uuid(),
  conditionVersion: z.number().int().positive().max(4294967294),
  ownerWallet: walletAddressSchema,
  custodyRevision: tokenAmountSchema,
  requestedAt: z.iso.datetime({ precision: 3 }),
});
export const resaleInspectionReviewSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    title: z.string().trim().min(1).max(200),
    cluster: walletClusterSchema,
    ownerWallet: walletAddressSchema,
    custodyState: z.enum(["KATHA_HELD", "COLLECTOR_HELD"]),
    custodyRevision: tokenAmountSchema,
    chainTime: tokenAmountSchema,
    secondary: z.boolean(),
    canList: z.boolean(),
    canRequest: z.boolean(),
    inspection: z.strictObject({
      status: z.enum(["NOT_REQUIRED", "APPROVED", "REQUIRED", "EXPIRED", "STALE"]),
      report: walletAddressSchema,
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      version: z.number().int().positive(),
      inspectedAt: tokenAmountSchema,
      validUntil: tokenAmountSchema.nullable(),
    }),
    requests: z.array(resaleInspectionRecordSchema).max(100),
  })
  .refine((v) => new Set(v.requests.map((r) => r.id)).size === v.requests.length)
  .refine(
    (v) => !v.canList || ["APPROVED", "NOT_REQUIRED"].includes(v.inspection.status),
  )
  .refine(
    (v) =>
      v.inspection.status !== "APPROVED" ||
      (v.custodyState === "COLLECTOR_HELD" &&
        v.inspection.validUntil !== null &&
        BigInt(v.chainTime) <= BigInt(v.inspection.validUntil) &&
        BigInt(v.inspection.inspectedAt) <= BigInt(v.chainTime)),
  )
  .refine(
    (v) => v.inspection.status !== "NOT_REQUIRED" || v.custodyState === "KATHA_HELD",
  )
  .refine(
    (v) =>
      !v.canRequest ||
      (v.secondary &&
        v.custodyState === "COLLECTOR_HELD" &&
        v.inspection.status !== "APPROVED"),
  );
export type ResaleInspectionRequest = z.infer<typeof resaleInspectionRequestSchema>;
export type ResaleInspectionReview = z.infer<typeof resaleInspectionReviewSchema>;
