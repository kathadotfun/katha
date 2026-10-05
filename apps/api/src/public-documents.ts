import type { PublicDocumentStore } from "@katha/db";
import { sha256Hex, metadataDocumentSchema } from "@katha/shared";
import { storedObjectSchema, type StorageProvider } from "./storage.js";
import { DomainError } from "./errors.js";

export function createPublicDocuments(
  store: PublicDocumentStore,
  storage: StorageProvider,
) {
  return {
    async read(filename: string) {
      const match = /^([0-9a-f]{64})\.(json|jpg|png|webp|avif|mp4|webm|pdf)$/.exec(
        filename,
      );
      if (!match) throw new DomainError("NOT_FOUND");
      const storageKey = `public/${filename}`;
      let reference;
      if (match[2] === "json") {
        const record = await store.findMetadata(match[1]!);
        if (!record?.canonicalDocument) throw new DomainError("NOT_FOUND");
        try {
          if (
            !metadataDocumentSchema.safeParse(JSON.parse(record.canonicalDocument))
              .success
          )
            throw new DomainError("NOT_FOUND");
        } catch {
          throw new DomainError("NOT_FOUND");
        }
        reference = storedObjectSchema.parse({
          storageKey,
          contentHash: record.documentHash,
          mimeType: "application/json",
          visibility: "PUBLIC",
          byteSize: String(new TextEncoder().encode(record.canonicalDocument).length),
        });
      } else {
        const record = await store.findMedia(storageKey);
        if (!record || record.visibility !== "PUBLIC")
          throw new DomainError("NOT_FOUND");
        reference = storedObjectSchema.parse({
          ...record,
          byteSize: record.byteSize.toString(),
        });
      }
      const bytes = await storage.read(reference);
      if ((await sha256Hex(bytes)) !== reference.contentHash)
        throw new DomainError("CONFLICT");
      return { bytes, mimeType: reference.mimeType };
    },
  };
}
export type PublicDocumentsBoundary = ReturnType<typeof createPublicDocuments>;
