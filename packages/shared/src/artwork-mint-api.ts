import {
  artworkRegistrationReviewSchema,
  registrationStatusSchema,
} from "./artwork-registration-review.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { physicalCustodyStateSchema } from "./artwork-lifecycle.js";
import { z } from "zod";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";
export const artworkMintRequestSchema = artworkRegistrationRequestSchema.extend({
  initialConditionReportId: z.uuid().transform((v) => v.toLowerCase()),
  expectedMetadataVersion: z.number().int().min(1).max(4294967295),
  expectedConditionVersion: z.number().int().min(1).max(4294967295),
  expectedCustodyRevision: z
    .string()
    .max(20)
    .regex(/^[1-9][0-9]*$/)
    .refine(
      (v) =>
        /^[1-9][0-9]*$/.test(v) && v.length <= 20 && BigInt(v) <= 18446744073709551615n,
    ),
});
export type ArtworkMintRequest = z.infer<typeof artworkMintRequestSchema>;

export const artworkPublicationRequestSchema = z.strictObject({
  expectedUpdatedAt: artworkMintRequestSchema.shape.expectedUpdatedAt,
  publicationConfirmed: z.literal(true),
});
export type ArtworkPublicationRequest = z.infer<typeof artworkPublicationRequestSchema>;
export const artworkMintReviewSchema = artworkRegistrationReviewSchema
  .omit({ registration: true })
  .extend({
    initialReport: z
      .strictObject({ id: z.uuid(), documentHash: z.string().regex(/^[0-9a-f]{64}$/) })
      .nullable(),
    chain: z
      .strictObject({
        asset: walletAddressSchema,
        collection: walletAddressSchema,
        collectionAuthority: walletAddressSchema,
        registrationAuthority: walletAddressSchema,
        owner: walletAddressSchema.nullable(),
        minted: z.boolean(),
        metadataVersion: artworkMintRequestSchema.shape.expectedMetadataVersion,
        conditionVersion: artworkMintRequestSchema.shape.expectedConditionVersion,
        custodyRevision: artworkMintRequestSchema.shape.expectedCustodyRevision,
        custodyState: physicalCustodyStateSchema,
      })
      .nullable(),
    reservation: z
      .strictObject({
        idempotencyKey: artworkMintRequestSchema.shape.idempotencyKey,
        walletAddress: walletAddressSchema,
        status: z.enum(["PREPARED", "UNKNOWN", "FINALIZED"]),
      })
      .nullable(),
    mint: registrationStatusSchema,
    canMint: z.boolean(),
    canPublish: z.boolean(),
    blockedReasons: z
      .array(
        z.enum([
          "ARTIST_UNVERIFIED",
          "DOCUMENTS_MISSING",
          "CHAIN_PREREQUISITES",
          "AUTHORITY_REQUIRED",
          "UNRESOLVED_MINT",
          "OTHER_RESERVATION",
          "INDEXING_PENDING",
        ]),
      )
      .max(7),
  });
export type ArtworkMintReview = z.infer<typeof artworkMintReviewSchema>;
