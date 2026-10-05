import { z } from "zod";
import { conditionReportDocumentSchema } from "./condition-report.js";
import { artworkSchema } from "./artwork-domain.js";

// The Devnet demonstration uses local/LAN services, including localhost and IP hosts.
const documentUri = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      value === value.trim()
    );
  } catch {
    return false;
  }
});
export const metadataPreparationRequestSchema = z.strictObject({
  expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
});
export const conditionPreparationRequestSchema =
  metadataPreparationRequestSchema.extend({
    reportId: conditionReportDocumentSchema.shape.reportId.transform((value) =>
      value.toLowerCase(),
    ),
    inspectorId: conditionReportDocumentSchema.shape.inspectorId.transform((value) =>
      value.toLowerCase(),
    ),
    grade: conditionReportDocumentSchema.shape.grade,
    reason: conditionReportDocumentSchema.shape.reason,
    inspectedAt: conditionReportDocumentSchema.shape.inspectedAt,
    reportedAt: conditionReportDocumentSchema.shape.reportedAt,
    notes: conditionReportDocumentSchema.shape.notes,
    mediaIds: z
      .array(z.uuid().transform((value) => value.toLowerCase()))
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
  });
export const metadataDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kathaId: artworkSchema.shape.kathaId,
  name: artworkSchema.shape.title,
  category: artworkSchema.shape.category,
  artist: artworkSchema.shape.attribution,
  creationYear: artworkSchema.shape.creationYear,
  origin: artworkSchema.shape.origin,
  dimensions: artworkSchema.shape.dimensions,
  materials: artworkSchema.shape.materials,
  technique: artworkSchema.shape.technique,
  publicContent: artworkSchema.shape.publicContent,
  image: documentUri,
  media: z
    .array(
      z.strictObject({
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        mimeType: z.string().min(1).max(100),
        role: z.string().min(1).max(32),
        uri: documentUri,
      }),
    )
    .min(1)
    .max(100),
});
export const preparedDocumentResponseSchema = z.strictObject({
  id: z.uuid(),
  kathaId: artworkSchema.shape.kathaId,
  version: z.number().int().min(1).max(4294967295),
  status: z.literal("PREPARED"),
  documentHash: z.string().regex(/^[0-9a-f]{64}$/),
  uri: documentUri.nullable(),
});
export type ConditionPreparationRequest = z.infer<
  typeof conditionPreparationRequestSchema
>;
