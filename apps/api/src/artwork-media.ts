import { MediaStoreConflict, type ArtworkMediaStore } from "@katha/db";
import {
  artworkMediaMimeSchema,
  artworkMediaUploadSchema,
  artworkMediaUpdateSchema,
  artworkMediaResponseSchema,
  artworkDraftParamsSchema,
  sha256Hex,
  type ArtworkMediaUpload,
} from "@katha/shared";
import {
  StorageError,
  storedObjectSchema,
  type StorageProvider,
  type StoredObject,
} from "./storage.js";
import { DomainError } from "./errors.js";
function response(
  snapshot: NonNullable<Awaited<ReturnType<ArtworkMediaStore["read"]>>>,
) {
  return artworkMediaResponseSchema.parse({
    kathaId: snapshot.artwork.kathaId,
    updatedAt: snapshot.artwork.updatedAt.toISOString(),
    editable: snapshot.editable,
    items: snapshot.items.map((item, position) => ({
      id: item.id,
      role: item.role,
      visibility: item.visibility,
      altText: item.altText,
      caption: item.caption,
      kind: item.kind,
      mimeType: item.mimeType,
      byteSize: item.byteSize.toString(),
      contentHash: item.contentHash,
      position,
    })),
  });
}
export function createArtworkMedia(store: ArtworkMediaStore, storage: StorageProvider) {
  async function execute(
    run: () => Promise<Awaited<ReturnType<ArtworkMediaStore["read"]>>>,
  ) {
    try {
      const result = await run();
      if (!result) throw new DomainError("NOT_FOUND");
      return response(result);
    } catch (error) {
      if (error instanceof MediaStoreConflict) throw new DomainError("CONFLICT");
      if (error instanceof StorageError && error.code === "TOO_LARGE")
        throw new DomainError("PAYLOAD_TOO_LARGE");
      if (error instanceof StorageError && error.code === "INVALID_OBJECT")
        throw new DomainError("INVALID_REQUEST");
      throw error;
    }
  }
  async function put(
    bytes: Uint8Array,
    input: Pick<ArtworkMediaUpload, "mimeType" | "visibility">,
  ): Promise<StoredObject> {
    const reference = storedObjectSchema.parse(await storage.put({ bytes, ...input }));
    if (
      reference.contentHash !== (await sha256Hex(bytes)) ||
      reference.mimeType !== input.mimeType ||
      reference.visibility !== input.visibility ||
      reference.byteSize !== String(bytes.length)
    )
      throw new DomainError("CONFLICT");
    return reference;
  }
  return {
    read(kathaId: string) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      return execute(() => store.read(path.kathaId));
    },
    upload(kathaId: string, input: unknown, bytes: Uint8Array) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const data = artworkMediaUploadSchema.parse(input);
      return execute(() =>
        store.write(path.kathaId, data.expectedUpdatedAt, async (items) => {
          if (
            items.length >= 20 ||
            (data.role === "HERO" && items.some((item) => item.role === "HERO"))
          )
            throw new MediaStoreConflict();
          const reference = await put(bytes, data);
          return [
            ...items,
            {
              ...reference,
              byteSize: BigInt(reference.byteSize),
              role: data.role,
              kind: data.mimeType.startsWith("image/")
                ? ("IMAGE" as const)
                : data.mimeType.startsWith("video/")
                  ? ("VIDEO" as const)
                  : ("DOCUMENT" as const),
              altText: data.altText,
              caption: data.caption,
            },
          ];
        }),
      );
    },
    update(kathaId: string, input: unknown) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const data = artworkMediaUpdateSchema.parse(input);
      return execute(() =>
        store.write(path.kathaId, data.expectedUpdatedAt, async (items) => {
          if (
            items.length !== data.items.length ||
            data.items.some((value) => !items.some((item) => item.id === value.id))
          )
            throw new MediaStoreConflict();
          const result = [];
          for (const value of data.items) {
            const item = items.find((item) => item.id === value.id)!;
            if (
              (value.role === "HERO" && item.kind !== "IMAGE") ||
              (value.visibility === "PUBLIC" &&
                item.kind === "IMAGE" &&
                value.altText === null)
            )
              throw new DomainError("INVALID_REQUEST");
            let reference = storedObjectSchema.parse({
              storageKey: item.storageKey,
              contentHash: item.contentHash,
              byteSize: item.byteSize.toString(),
              mimeType: item.mimeType,
              visibility: item.visibility,
            });
            if (item.visibility !== value.visibility) {
              const bytes = await storage.read(reference);
              if (
                (await sha256Hex(bytes)) !== item.contentHash ||
                bytes.length !== Number(item.byteSize)
              )
                throw new DomainError("CONFLICT");
              reference = await put(bytes, {
                mimeType: artworkMediaMimeSchema.parse(reference.mimeType),
                visibility: value.visibility,
              });
            }
            result.push({
              ...item,
              ...reference,
              byteSize: BigInt(reference.byteSize),
              role: value.role,
              visibility: value.visibility,
              altText: value.altText,
              caption: value.caption,
            });
          }
          return result;
        }),
      );
    },
  };
}
export type ArtworkMediaBoundary = ReturnType<typeof createArtworkMedia>;
