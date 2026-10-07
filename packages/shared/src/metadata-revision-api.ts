import { z } from "zod";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";

export const metadataRevisionRequestSchema = artworkRegistrationRequestSchema
  .extend({
    expectedMetadataVersion: z.number().int().min(0).max(4294967294),
    expectedMetadataHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
  })
  .refine(
    (v) => (v.expectedMetadataVersion === 0) === (v.expectedMetadataHash === null),
  );
export type MetadataRevisionRequest = z.infer<typeof metadataRevisionRequestSchema>;

import {
  artworkRegistrationReviewSchema,
  registrationStatusSchema,
} from "./artwork-registration-review.js";
import { metadataDocumentSchema } from "./document-preparation.js";
import { walletAddressSchema } from "./artwork-domain.js";
export const metadataRevisionDocumentRequestSchema = z.strictObject({
  expectedUpdatedAt: artworkRegistrationRequestSchema.shape.expectedUpdatedAt,
  metadataVersionId: z.uuid(),
  publicContent: metadataDocumentSchema.shape.publicContent,
  publicApprovalConfirmed: z.literal(true),
});
export type MetadataRevisionDocumentRequest = z.infer<
  typeof metadataRevisionDocumentRequestSchema
>;
export const metadataRevisionReviewSchema = artworkRegistrationReviewSchema
  .omit({ registration: true })
  .extend({
    current: artworkRegistrationReviewSchema.shape.metadata,
    chain: z.strictObject({
      mode: z.enum(["INITIALIZE", "UNMINTED", "MINTED"]),
      version: z.number().int().min(0).max(4294967295),
      documentHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .nullable(),
      uri: metadataDocumentSchema.shape.image.nullable(),
      registrationAuthority: walletAddressSchema,
      collection: walletAddressSchema,
      collectionAuthority: walletAddressSchema,
      asset: walletAddressSchema.nullable(),
    }),
    revision: registrationStatusSchema,
    canSave: z.boolean(),
    canSubmit: z.boolean(),
  });
export type MetadataRevisionReview = z.infer<typeof metadataRevisionReviewSchema>;
