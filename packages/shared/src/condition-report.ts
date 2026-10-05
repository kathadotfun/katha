import { z } from "zod";

import { walletAddressSchema } from "./artwork-domain.js";
import { kathaIdSchema } from "./artwork-identity.js";

export const conditionGradeSchema = z.enum([
  "EXCELLENT",
  "GOOD",
  "FAIR",
  "POOR",
  "DAMAGED",
]);
export type ConditionGrade = z.infer<typeof conditionGradeSchema>;

export const conditionReasonSchema = z.enum([
  "INITIAL_VERIFICATION",
  "PRE_SALE",
  "POST_DELIVERY",
  "PRE_RESALE",
  "RETURN_TO_CUSTODY",
  "INSURANCE",
]);
export type ConditionReason = z.infer<typeof conditionReasonSchema>;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

// One UTC millisecond representation avoids multiple strings for the same instant.
const utcTimestampSchema = z.iso.datetime({ precision: 3 }).refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
});

export const conditionReportDocumentSchema = z
  .strictObject({
    reportId: z.uuid(),
    kathaId: kathaIdSchema,
    grade: conditionGradeSchema,
    reason: conditionReasonSchema,
    inspectorId: z.uuid(),
    verifierWallet: walletAddressSchema,
    inspectedAt: utcTimestampSchema,
    reportedAt: utcTimestampSchema,
    notes: z
      .string()
      .min(1)
      .max(5000)
      .refine((value) => value.trim().length > 0),
    scope: z
      .strictObject({
        ownerWallet: walletAddressSchema,
        custodyRevision: z.number().int().min(1).max(4294967295),
        custodyState: z.enum(["KATHA_HELD", "COLLECTOR_HELD"]),
      })
      .optional(),
    mediaHashes: z
      .array(sha256Schema)
      .min(1)
      .max(20)
      .refine((hashes) => new Set(hashes).size === hashes.length),
  })
  .refine((report) => report.reportedAt >= report.inspectedAt, {
    error: "Report time cannot precede inspection time",
    path: ["reportedAt"],
  });
export type ConditionReportDocument = z.infer<typeof conditionReportDocumentSchema>;

// The canonical document hash is outside the document to avoid self-reference.
export const conditionReportCommitmentSchema = z.strictObject({
  reportId: z.uuid(),
  kathaId: kathaIdSchema,
  reportHash: sha256Schema,
});
export type ConditionReportCommitment = z.infer<typeof conditionReportCommitmentSchema>;
