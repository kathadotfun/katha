import { z } from "zod";
import { kathaIdSchema } from "./artwork-identity.js";
export const artworkMediaMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);
export const artworkMediaRoleSchema = z.enum([
  "HERO",
  "FRONT",
  "BACK",
  "DETAIL",
  "ARTIST",
  "PROCESS",
  "CERTIFICATE",
  "CONDITION",
  "DOCUMENTARY",
  "OTHER",
]);
const text = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      // eslint-disable-next-line no-control-regex -- Reject unsupported stored text controls.
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
    );
const fields = {
  role: artworkMediaRoleSchema,
  visibility: z.enum(["PRIVATE", "PUBLIC"]),
  altText: text(500).nullable(),
  caption: text(1000).nullable(),
};
const approval = (value: {
  role: string;
  visibility: string;
  approvedPublic: boolean;
}) =>
  value.visibility !== "PUBLIC" || (value.approvedPublic && value.role !== "CONDITION");
export const artworkMediaUploadSchema = z
  .strictObject({
    expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
    mimeType: artworkMediaMimeSchema,
    ...fields,
    approvedPublic: z.boolean(),
  })
  .refine(approval, {
    error: "Public media requires explicit approval; condition evidence stays private",
  })
  .refine((value) => value.role !== "HERO" || value.mimeType.startsWith("image/"), {
    path: ["role"],
    error: "Hero must be an image",
  })
  .refine(
    (value) =>
      value.visibility !== "PUBLIC" ||
      !value.mimeType.startsWith("image/") ||
      value.altText !== null,
    { path: ["altText"], error: "Public photographs require an image description" },
  );
export const artworkMediaEditItemSchema = z
  .strictObject({
    id: z.uuid().transform((value) => value.toLowerCase()),
    ...fields,
    approvedPublic: z.boolean(),
  })
  .refine(approval, {
    error: "Public media requires explicit approval; condition evidence stays private",
  });
export const artworkMediaUpdateSchema = z
  .strictObject({
    expectedUpdatedAt: z.iso.datetime({ precision: 3 }),
    items: z.array(artworkMediaEditItemSchema).max(20),
  })
  .refine(
    ({ items }) =>
      new Set(items.map((item) => item.id)).size === items.length &&
      items.filter((item) => item.role === "HERO").length <= 1,
    { error: "Each file occurs once, with at most one hero" },
  );
export const artworkMediaResponseSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    updatedAt: z.iso.datetime({ precision: 3 }),
    editable: z.boolean(),
    items: z
      .array(
        z.strictObject({
          id: z.uuid().transform((value) => value.toLowerCase()),
          ...fields,
          kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]),
          mimeType: artworkMediaMimeSchema,
          byteSize: z.string().regex(/^[1-9][0-9]*$/),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          position: z.number().int().min(0).max(19),
        }),
      )
      .max(20),
  })
  .refine(
    ({ items }) =>
      items.every(
        (item, index) =>
          item.position === index &&
          (item.role !== "HERO" || item.kind === "IMAGE") &&
          (item.visibility !== "PUBLIC" ||
            (item.role !== "CONDITION" &&
              (item.kind !== "IMAGE" || item.altText !== null))) &&
          (item.kind === "IMAGE"
            ? item.mimeType.startsWith("image/")
            : item.kind === "VIDEO"
              ? item.mimeType.startsWith("video/")
              : item.mimeType === "application/pdf"),
      ) && new Set(items.map((item) => item.id)).size === items.length,
    { error: "Media must have unique identities and contiguous order" },
  );
export type ArtworkMediaResponse = z.infer<typeof artworkMediaResponseSchema>;
export type ArtworkMediaUpload = z.infer<typeof artworkMediaUploadSchema>;
export type ArtworkMediaUpdate = z.infer<typeof artworkMediaUpdateSchema>;

export const ARTWORK_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
