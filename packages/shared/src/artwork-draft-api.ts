import { z } from "zod";
import { artworkCategorySchema, kathaIdSchema } from "./artwork-identity.js";
import { paginatedResponseSchema, paginationQuerySchema } from "./http.js";
import { artistIdParamsSchema } from "./artist-api.js";
import {
  artworkDimensionsSchema,
  artworkOriginSchema,
  artworkPublicContentSchema,
  artworkSchema,
  walletAddressSchema,
} from "./artwork-domain.js";

const content = (schema: z.ZodString) =>
  schema.refine(
    // eslint-disable-next-line no-control-regex -- Reject text controls unsupported by profile/document storage.
    (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  );
const dimensions = artworkDimensionsSchema.extend({
  heightMm: artworkDimensionsSchema.shape.heightMm.max(2147483647),
  widthMm: artworkDimensionsSchema.shape.widthMm.max(2147483647),
  depthMm: z.number().int().positive().max(2147483647).nullish(),
});
const origin = artworkOriginSchema.extend({
  region: content(artworkOriginSchema.shape.region).nullish(),
  locality: content(artworkOriginSchema.shape.locality.unwrap().unwrap()).nullish(),
});
const draftFields = {
  artistId: artistIdParamsSchema.shape.artistId,
  category: artworkCategorySchema,
  title: content(artworkSchema.shape.title),
  creationYear: artworkSchema.shape.creationYear,
  authorshipEvidenceHash: artworkSchema.shape.authorshipEvidenceHash.nullish(),
  dimensions: dimensions.nullish(),
  origin: origin.optional(),
  technique: content(artworkSchema.shape.technique).nullish(),
  story: content(artworkPublicContentSchema.shape.story).nullish(),
  meaning: content(artworkPublicContentSchema.shape.meaning).nullish(),
  culturalContext: content(artworkPublicContentSchema.shape.culturalContext).nullish(),
  creationProcess: content(artworkPublicContentSchema.shape.creationProcess).nullish(),
};
export const artworkDraftCreateRequestSchema = z.strictObject({
  // Retain this UUID when retrying an uncertain creation request.
  creationRequestId: z.uuid().transform((value) => value.toLowerCase()),
  ...draftFields,
});
export const artworkDraftResponseSchema = z
  .strictObject({
    ...draftFields,
    id: z.uuid(),
    kathaId: kathaIdSchema,
    creatorWallet: walletAddressSchema.nullable(),
    authorshipEvidenceHash: artworkSchema.shape.authorshipEvidenceHash.nullable(),
    dimensions: dimensions.nullable(),
    origin: origin,
    technique: draftFields.technique.unwrap().unwrap().nullable(),
    story: draftFields.story.unwrap().unwrap().nullable(),
    meaning: draftFields.meaning.unwrap().unwrap().nullable(),
    culturalContext: draftFields.culturalContext.unwrap().unwrap().nullable(),
    creationProcess: draftFields.creationProcess.unwrap().unwrap().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine((record) => record.kathaId.startsWith(`KATHA-${record.category}-`), {
    path: ["kathaId"],
    error: "Category must match permanent ID",
  });
export type ArtworkDraftCreateRequest = z.infer<typeof artworkDraftCreateRequestSchema>;
export type ArtworkDraftResponse = z.infer<typeof artworkDraftResponseSchema>;

export const artworkDraftParamsSchema = z.strictObject({ kathaId: kathaIdSchema });
export const artworkDraftUpdateRequestSchema = z
  .strictObject({
    expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
    title: draftFields.title.optional(),
    authorshipEvidenceHash: draftFields.authorshipEvidenceHash,
    dimensions: draftFields.dimensions,
    origin: draftFields.origin,
    technique: draftFields.technique,
    story: draftFields.story,
    meaning: draftFields.meaning,
    culturalContext: draftFields.culturalContext,
    creationProcess: draftFields.creationProcess,
  })
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== "expectedUpdatedAt" && value !== undefined,
      ),
    {
      error: "At least one content edit is required",
    },
  );
export type ArtworkDraftUpdateRequest = z.infer<typeof artworkDraftUpdateRequestSchema>;

export const artworkDraftListQuerySchema = paginationQuerySchema;
export const artworkDraftListItemSchema = z
  .strictObject({
    id: z.uuid(),
    kathaId: kathaIdSchema,
    category: artworkCategorySchema,
    title: draftFields.title,
    creationYear: draftFields.creationYear,
    artist: z.strictObject({
      id: artistIdParamsSchema.shape.artistId,
      displayName: z.string().trim().min(1).max(160),
      verificationStatus: z.enum(["UNVERIFIED", "VERIFIED"]),
    }),
    workflowStatus: z.enum(["DOCUMENTING", "LIFECYCLE_STARTED"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine((item) => item.kathaId.startsWith(`KATHA-${item.category}-`), {
    path: ["kathaId"],
    error: "Category must match permanent ID",
  });
export const artworkDraftListResponseSchema = paginatedResponseSchema(
  artworkDraftListItemSchema,
).refine(
  ({ items }) => new Set(items.map((item) => item.kathaId)).size === items.length,
  { error: "Duplicate artwork identities" },
);
export type ArtworkDraftListResponse = z.infer<typeof artworkDraftListResponseSchema>;
