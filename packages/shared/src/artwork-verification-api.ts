import { z } from "zod";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";

export const artworkVerificationRequestSchema = artworkRegistrationRequestSchema.extend(
  {
    // Explicit manual confirmation is an attestation by the authorized verifier.
    authenticityConfirmed: z.literal(true),
  },
);
export type ArtworkVerificationRequest = z.infer<
  typeof artworkVerificationRequestSchema
>;
