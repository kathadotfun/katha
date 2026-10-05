import { z } from "zod";

export const storageMimeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "application/json",
]);
export type StorageMime = z.infer<typeof storageMimeSchema>;
export const storageVisibilitySchema = z.enum(["PUBLIC", "PRIVATE"]);
export type StorageVisibility = z.infer<typeof storageVisibilitySchema>;
export const storageExtensions: Readonly<Record<StorageMime, string>> = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/json": "json",
});
export const storedObjectSchema = z
  .strictObject({
    storageKey: z.string(),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    mimeType: storageMimeSchema,
    byteSize: z.string().regex(/^[1-9][0-9]*$/),
    visibility: storageVisibilitySchema,
  })
  .refine(
    (value) =>
      value.storageKey ===
      `${value.visibility.toLowerCase()}/${value.contentHash}.${storageExtensions[value.mimeType]}`,
    {
      path: ["storageKey"],
      error: "Invalid storage reference",
    },
  );
export type StoredObject = z.infer<typeof storedObjectSchema>;
export interface StorageProvider {
  put(input: {
    bytes: Uint8Array;
    mimeType: StorageMime;
    visibility: StorageVisibility;
  }): Promise<StoredObject>;
  read(reference: StoredObject): Promise<Uint8Array>;
}
export class StorageError extends Error {
  constructor(
    readonly code:
      | "INVALID_OBJECT"
      | "TOO_LARGE"
      | "UNSAFE_PATH"
      | "NOT_FOUND"
      | "INTEGRITY_FAILURE"
      | "IO_FAILURE",
  ) {
    super(`Storage operation failed: ${code}`);
    this.name = "StorageError";
  }
}
