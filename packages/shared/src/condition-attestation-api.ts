import { z } from "zod";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";
export const conditionAttestationRequestSchema = artworkRegistrationRequestSchema
  .omit({ metadataVersionId: true })
  .extend({
    reportId: z.uuid().transform((value) => value.toLowerCase()),
    expectedConditionVersion: z.number().int().min(0).max(4294967294),
  });
export type ConditionAttestationRequest = z.infer<
  typeof conditionAttestationRequestSchema
>;
