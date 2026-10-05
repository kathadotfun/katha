import {
  metadataDocumentSchema,
  canonicalDocumentBytes,
  sha256Hex,
} from "@katha/shared";
import type { ArtworkRegistrationSnapshot } from "@katha/db";
import { StorageError, type StorageProvider } from "./storage.js";
import { DomainError } from "./errors.js";

/** Validate the selected public document against the immutable artwork snapshot. */
export async function validateArtworkDocumentation(
  snapshot: ArtworkRegistrationSnapshot,
  storage: StorageProvider,
) {
  const { artwork, metadata } = snapshot;
  if (!metadata?.canonicalDocument || !metadata.documentHash || !metadata.uri)
    throw new DomainError("CONFLICT");
  let document;
  try {
    document = metadataDocumentSchema.parse(JSON.parse(metadata.canonicalDocument));
  } catch {
    throw new DomainError("CONFLICT");
  }
  const bytes = canonicalDocumentBytes(document);
  if (
    new TextDecoder().decode(bytes) !== metadata.canonicalDocument ||
    (await sha256Hex(bytes)) !== metadata.documentHash ||
    document.kathaId !== artwork.kathaId ||
    document.category !== artwork.category ||
    document.name !== artwork.title ||
    document.creationYear !== artwork.creationYear ||
    document.artist.artistId !== artwork.artistId ||
    (document.artist.creatorWallet ?? null) !== artwork.creatorWallet
  )
    throw new DomainError("CONFLICT");
  // Read our provider's exact approved bytes, never fetch a client-supplied URI.
  let stored: Uint8Array;
  try {
    stored = await storage.read({
      storageKey: `public/${metadata.documentHash}.json`,
      contentHash: metadata.documentHash,
      mimeType: "application/json",
      visibility: "PUBLIC",
      byteSize: bytes.byteLength.toString(),
    });
  } catch (error) {
    if (
      error instanceof StorageError &&
      ["NOT_FOUND", "INTEGRITY_FAILURE"].includes(error.code)
    )
      throw new DomainError("CONFLICT");
    throw error;
  }
  if (
    (await sha256Hex(stored)) !== metadata.documentHash ||
    new TextDecoder().decode(stored) !== metadata.canonicalDocument
  )
    throw new DomainError("CONFLICT");
}
