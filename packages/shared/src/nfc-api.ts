import { z } from "zod";
import { kathaIdSchema } from "./artwork-identity.js";

// Public URL reference, not a hardware UID, credential or authenticity proof.
export const nfcTagIdSchema = z.uuid().refine((value) => value === value.toLowerCase());
export const nfcArtworkParamsSchema = z.strictObject({ kathaId: kathaIdSchema });
export const nfcTagParamsSchema = z.strictObject({ tagId: nfcTagIdSchema });
export const nfcTagAssignmentRequestSchema = z.strictObject({ tagId: nfcTagIdSchema });
export const nfcTagRetirementRequestSchema = z.strictObject({});
export const nfcTagResponseSchema = z
  .strictObject({
    tagId: nfcTagIdSchema,
    kathaId: kathaIdSchema,
    state: z.enum(["ACTIVE", "RETIRED"]),
    assignedAt: z.iso.datetime(),
    retiredAt: z.iso.datetime().nullable(),
  })
  .refine((value) =>
    value.state === "ACTIVE"
      ? value.retiredAt === null
      : value.retiredAt !== null &&
        Date.parse(value.retiredAt) >= Date.parse(value.assignedAt),
  );
export type NfcTagResponse = z.infer<typeof nfcTagResponseSchema>;
