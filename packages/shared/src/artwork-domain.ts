import { z } from "zod";

import { artworkCategorySchema, kathaIdSchema } from "./artwork-identity.js";

const nonBlank = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0);

// This checks the textual shape only; chain-facing code must decode the address.
export const walletAddressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const artistAttributionSchema = z.strictObject({
  artistId: z.uuid(),
  displayName: nonBlank(160),
  creatorWallet: walletAddressSchema.nullish(),
});
export type ArtistAttribution = z.infer<typeof artistAttributionSchema>;

export const artistProfileSchema = z.strictObject({
  attribution: artistAttributionSchema,
  payoutWallet: walletAddressSchema.nullish(),
  biography: nonBlank(5000),
  region: nonBlank(120),
  traditions: z.array(nonBlank(120)).min(1).max(20),
  publicLinks: z.array(z.httpUrl()).max(10),
});
export type ArtistProfile = z.infer<typeof artistProfileSchema>;

export const artworkOriginSchema = z.strictObject({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  region: nonBlank(120),
  locality: nonBlank(120).nullish(),
});
export type ArtworkOrigin = z.infer<typeof artworkOriginSchema>;

export const artworkDimensionsSchema = z.strictObject({
  heightMm: z.number().int().positive(),
  widthMm: z.number().int().positive(),
  depthMm: z.number().int().positive().nullish(),
});
export type ArtworkDimensions = z.infer<typeof artworkDimensionsSchema>;

export const artworkPublicContentSchema = z.strictObject({
  story: nonBlank(10000),
  meaning: nonBlank(5000),
  culturalContext: nonBlank(5000),
  creationProcess: nonBlank(5000),
});
export type ArtworkPublicContent = z.infer<typeof artworkPublicContentSchema>;

export const artworkSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    category: artworkCategorySchema,
    title: nonBlank(200),
    attribution: artistAttributionSchema,
    authorshipEvidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
    creationYear: z.number().int().min(1).max(9999),
    origin: artworkOriginSchema,
    dimensions: artworkDimensionsSchema,
    materials: z.array(nonBlank(120)).min(1).max(20),
    technique: nonBlank(500),
    publicContent: artworkPublicContentSchema,
  })
  .refine((artwork) => artwork.kathaId.startsWith(`KATHA-${artwork.category}-`), {
    error: "Katha ID category must match the artwork category",
    path: ["kathaId"],
  });
export type Artwork = z.infer<typeof artworkSchema>;
