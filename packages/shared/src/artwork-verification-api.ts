import { z } from "zod";
import { registrationIdentitySchema } from "./artwork-registration-review.js";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";

export const artworkVerificationRequestSchema = artworkRegistrationRequestSchema.extend(
  {
    // Explicit manual confirmation is an attestation by the authorized verifier.
    authenticityConfirmed: z.literal(true),
    reviewedEvidenceHash: registrationIdentitySchema.shape.authorshipEvidenceHash,
  },
);
export type ArtworkVerificationRequest = z.infer<
  typeof artworkVerificationRequestSchema
>;
