import { z } from "zod";
import { artworkSchema, walletAddressSchema } from "./artwork-domain.js";
import { metadataDocumentSchema } from "./document-preparation.js";
import { walletClusterSchema } from "./wallet-session.js";
import { tokenAmountSchema } from "./marketplace.js";
export const registrationIdentitySchema = z.strictObject({
  artistId: artworkSchema.shape.attribution.shape.artistId,
  creatorWallet: walletAddressSchema.nullable(),
  category: artworkSchema.shape.category,
  creationYear: artworkSchema.shape.creationYear,
  authorshipEvidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const registrationStatusSchema = z
  .strictObject({
    finalized: z.boolean(),
    unresolved: z.boolean(),
    receipt: z
      .strictObject({
        status: z.enum(["UNKNOWN", "FAILED", "FINALIZED"]),
        signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
        slot: tokenAmountSchema.nullable(),
        indexed: z.boolean(),
      })
      .nullable(),
  })
  .refine((value) => !value.receipt?.indexed || value.receipt.status === "FINALIZED");
export const artworkRegistrationReviewSchema = z.strictObject({
  kathaId: artworkSchema.shape.kathaId,
  cluster: walletClusterSchema,
  updatedAt: z.iso.datetime({ precision: 3 }),
  title: artworkSchema.shape.title,
  identity: registrationIdentitySchema.nullable(),
  artistVerified: z.boolean(),
  published: z.boolean(),
  metadata: z
    .strictObject({
      id: z.uuid(),
      version: z.number().int().positive(),
      status: z.enum(["PREPARED", "FINALIZED"]),
      documentHash: z.string().regex(/^[0-9a-f]{64}$/),
      uri: metadataDocumentSchema.shape.image,
      canonicalDocument: z.string().min(1).max(1048576),
    })
    .nullable(),
  registration: registrationStatusSchema,
});
export type RegistrationIdentity = z.infer<typeof registrationIdentitySchema>;
export type ArtworkRegistrationReview = z.infer<typeof artworkRegistrationReviewSchema>;
