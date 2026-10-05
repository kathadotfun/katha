import { z } from "zod";
import { artworkCategorySchema, kathaIdSchema } from "./artwork-identity.js";
import { artworkSchema } from "./artwork-domain.js";
import { publicArtistSummarySchema } from "./artist-api.js";
import { paginationQuerySchema, paginatedResponseSchema } from "./http.js";

export const artworkDiscoveryQuerySchema = paginationQuerySchema.extend({
  category: artworkCategorySchema.optional(),
  artistId: publicArtistSummarySchema.shape.id.optional(),
});
export const publicArtworkSummarySchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    category: artworkCategorySchema,
    title: artworkSchema.shape.title,
    creationYear: artworkSchema.shape.creationYear,
    artist: z.strictObject({
      id: publicArtistSummarySchema.shape.id,
      slug: publicArtistSummarySchema.shape.slug,
      displayName: publicArtistSummarySchema.shape.displayName,
    }),
    heroImage: z
      .strictObject({
        id: z.uuid(),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        mimeType: z.string().min(1).max(100),
        altText: z
          .string()
          .min(1)
          .max(500)
          .refine((value) => value.trim().length > 0),
      })
      .nullable(),
  })
  .refine((value) => value.kathaId.startsWith(`KATHA-${value.category}-`), {
    path: ["kathaId"],
    error: "Category must match permanent ID",
  });
export const artworkDiscoveryResponseSchema = paginatedResponseSchema(
  publicArtworkSummarySchema,
);
export type ArtworkDiscoveryQuery = z.infer<typeof artworkDiscoveryQuerySchema>;
export type PublicArtworkSummary = z.infer<typeof publicArtworkSummarySchema>;
