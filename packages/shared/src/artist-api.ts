import { z } from "zod";
import {
  artistAttributionSchema,
  artistProfileSchema,
  walletAddressSchema,
} from "./artwork-domain.js";

// PostgreSQL text cannot contain NUL; other control characters are not profile content.
const content = (schema: z.ZodString) =>
  schema.refine(
    // eslint-disable-next-line no-control-regex -- Intentionally rejects unsupported text controls.
    (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  );
export const artistSlugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const artistIdParamsSchema = z.strictObject({
  artistId: artistAttributionSchema.shape.artistId.transform((value) =>
    value.toLowerCase(),
  ),
});
const publicUrl = z
  .httpUrl()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password && !/\s/u.test(value);
    } catch {
      return false;
    }
  });
export const artistCreateRequestSchema = z.strictObject({
  slug: artistSlugSchema,
  displayName: content(artistAttributionSchema.shape.displayName),
  biography: content(artistProfileSchema.shape.biography),
  region: content(artistProfileSchema.shape.region),
  traditions: z
    .array(content(artistProfileSchema.shape.traditions.element))
    .min(1)
    .max(20),
  publicLinks: z
    .array(publicUrl)
    .max(10)
    .default(() => []),
  profileImageUrl: publicUrl.nullish(),
  creatorWallet: artistAttributionSchema.shape.creatorWallet,
  payoutWallet: artistProfileSchema.shape.payoutWallet,
});
export const artistVerificationRequestSchema = z.strictObject({
  confirmed: z.literal(true),
});
export const artistResponseSchema = z
  .strictObject({
    ...artistCreateRequestSchema.shape,
    publicLinks: z.array(publicUrl).max(10),
    profileImageUrl: publicUrl.nullable(),
    creatorWallet: walletAddressSchema.nullable(),
    payoutWallet: walletAddressSchema.nullable(),
    id: z.uuid(),
    verificationStatus: z.enum(["UNVERIFIED", "VERIFIED"]),
    verifiedByWallet: walletAddressSchema.nullable(),
    verifiedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine((value) =>
    value.verificationStatus === "VERIFIED"
      ? value.verifiedByWallet !== null && value.verifiedAt !== null
      : value.verifiedByWallet === null && value.verifiedAt === null,
  );
export type ArtistCreateRequest = z.infer<typeof artistCreateRequestSchema>;
export type ArtistResponse = z.infer<typeof artistResponseSchema>;
