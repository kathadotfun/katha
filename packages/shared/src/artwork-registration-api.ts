import { z } from "zod";

export const artworkRegistrationRequestSchema = z.strictObject({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
  metadataVersionId: z.uuid().transform((value) => value.toLowerCase()),
  supportedTransactionVersions: z
    .array(z.union([z.literal(0), z.literal(1)]))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length),
});
export type ArtworkRegistrationRequest = z.infer<
  typeof artworkRegistrationRequestSchema
>;
