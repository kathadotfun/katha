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

export const nfcResolutionQuerySchema = z.strictObject({});

// Every tag bound to one artwork, newest first, including retired ones.
export const nfcTagListResponseSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    items: z.array(nfcTagResponseSchema).max(100),
  })
  .refine(
    ({ kathaId, items }) =>
      items.every((item) => item.kathaId === kathaId) &&
      new Set(items.map((item) => item.tagId)).size === items.length,
  );
export type NfcTagListResponse = z.infer<typeof nfcTagListResponseSchema>;

// Public answer for a tapped tag. Only an active tag on a published work names
// the artwork; retired and unpublished bindings stay anonymous.
export const nfcTagStatusSchema = z.enum([
  "ACTIVE",
  "RETIRED",
  "UNPUBLISHED",
  "UNKNOWN",
]);
export const nfcTagStatusResponseSchema = z
  .strictObject({
    tagId: nfcTagIdSchema,
    state: nfcTagStatusSchema,
    kathaId: kathaIdSchema.nullable(),
  })
  .refine((value) => (value.state === "ACTIVE") === (value.kathaId !== null));
export type NfcTagStatusResponse = z.infer<typeof nfcTagStatusResponseSchema>;
