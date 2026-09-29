import { z } from "zod";

export const artworkCategories = ["MANDALA", "PAUBHA", "THANGKA"] as const;

export const artworkCategorySchema = z.enum(artworkCategories);
export type ArtworkCategory = z.infer<typeof artworkCategorySchema>;

// Six digits preserve the public ID shape; zero is reserved because allocation starts at one.
const kathaIdPattern = new RegExp(
  `^KATHA-(?:${artworkCategories.join("|")})-(?!000000$)[0-9]{6}$`,
);

export const kathaIdSchema = z.string().regex(kathaIdPattern);
export type KathaId = z.infer<typeof kathaIdSchema>;
