import { z } from "zod";
import { artworkSchema } from "./artwork-domain.js";
import { walletClusterSchema } from "./wallet-session.js";
import {
  conditionReportDocumentSchema,
  conditionReasonSchema,
} from "./condition-report.js";
import { registrationStatusSchema } from "./artwork-registration-review.js";
export const conditionInspectionReviewSchema = z
  .strictObject({
    kathaId: artworkSchema.shape.kathaId,
    title: artworkSchema.shape.title,
    updatedAt: z.iso.datetime({ precision: 3 }),
    cluster: walletClusterSchema,
    chain: z.strictObject({
      version: z.number().int().min(0).max(4294967294),
      minted: z.boolean(),
      scope: conditionReportDocumentSchema.shape.scope.unwrap().nullable(),
      observedAt: z.iso.datetime({ precision: 3 }),
      allowedReasons: z.array(conditionReasonSchema).min(1).max(6),
    }),
    media: z
      .array(
        z.strictObject({
          id: z.uuid(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif"]),
          byteSize: z.string().regex(/^[1-9][0-9]*$/),
        }),
      )
      .max(20),
    report: z
      .strictObject({
        id: z.uuid(),
        version: z.number().int().positive(),
        status: z.enum(["PREPARED", "FINALIZED"]),
        documentHash: z.string().regex(/^[0-9a-f]{64}$/),
        canonicalDocument: z.string().min(1).max(65536),
      })
      .nullable(),
    attestation: registrationStatusSchema,
    unresolved: z.boolean(),
  })
  .refine(
    (value) =>
      value.chain.minted === Boolean(value.chain.scope) &&
      (!value.chain.minted || value.chain.version > 0),
    { error: "Condition scope must match minted state", path: ["chain"] },
  );
export type ConditionInspectionReview = z.infer<typeof conditionInspectionReviewSchema>;
