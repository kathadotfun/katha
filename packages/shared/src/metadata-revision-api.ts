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
