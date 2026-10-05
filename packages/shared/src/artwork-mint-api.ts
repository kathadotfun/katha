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
