import { createHash } from "node:crypto";
import { z } from "zod";
import { validateStorageBytes } from "./storage-content.js";
import {
  StorageError,
  storageExtensions,
  storageMimeSchema,
  storageVisibilitySchema,
  storedObjectSchema,
  type StoredObject,
  type StorageProvider,
} from "./storage.js";

export const cloudinaryCredentialsSchema = z.object({
  cloudName: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
  apiKey: z.string().regex(/^[0-9]{1,64}$/),
  apiSecret: z.string().min(1).max(256).regex(/^\S+$/),
});
const uploadResponseSchema = z.object({
  public_id: z.string(),
  resource_type: z.literal("raw"),
  type: z.literal("authenticated"),
  bytes: z.number().int().positive(),
});
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function boundedBody(response: Response, limit: number): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || BigInt(length) > BigInt(limit))) {
    await response.body?.cancel();
    throw new StorageError("INTEGRITY_FAILURE");
  }
  if (!response.body) throw new StorageError("INTEGRITY_FAILURE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new StorageError("INTEGRITY_FAILURE");
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** All originals stay authenticated; Katha's routes decide which bytes are public. */
export function createCloudinaryStorageProvider(
  options: z.infer<typeof cloudinaryCredentialsSchema> & {
    maxBytes?: number;
    fetch?: typeof fetch;
  },
): StorageProvider {
  const credentials = cloudinaryCredentialsSchema.safeParse(options);
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  if (
    !credentials.success ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 50 * 1024 * 1024
  )
    throw new StorageError("INVALID_OBJECT");
  const { cloudName, apiKey, apiSecret } = credentials.data;
  const send = options.fetch ?? globalThis.fetch;
  const publicId = (reference: StoredObject) => `katha/${reference.storageKey}`;

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await send(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // Provider errors may contain signed URLs, API keys or request bodies.
      throw new StorageError("IO_FAILURE");
    }
  }
  async function load(reference: StoredObject): Promise<Uint8Array> {
    const size = BigInt(reference.byteSize);
    if (size > BigInt(maxBytes)) throw new StorageError("TOO_LARGE");
    const id = publicId(reference);
    const signature = createHash("sha256")
      .update(id + apiSecret)
      .digest("base64url")
      .slice(0, 8);
    const response = await request(
      `https://res.cloudinary.com/${cloudName}/raw/authenticated/s--${signature}--/v1/${id}`,
      { method: "GET", cache: "no-store" },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new StorageError(response.status === 404 ? "NOT_FOUND" : "IO_FAILURE");
    }
    const bytes = await boundedBody(response, Number(size));
    if (
      String(bytes.length) !== reference.byteSize ||
      hash(bytes) !== reference.contentHash
    )
      throw new StorageError("INTEGRITY_FAILURE");
    validateStorageBytes(bytes, reference.mimeType, maxBytes);
    return bytes;
  }
  async function safely<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError("IO_FAILURE");
    }
  }
  return {
    async put(input) {
      if (
        !storageMimeSchema.safeParse(input.mimeType).success ||
        !storageVisibilitySchema.safeParse(input.visibility).success ||
        !(input.bytes instanceof Uint8Array)
      )
        throw new StorageError("INVALID_OBJECT");
      if (input.bytes.length > maxBytes) throw new StorageError("TOO_LARGE");
      const bytes = Uint8Array.from(input.bytes);
      validateStorageBytes(bytes, input.mimeType, maxBytes);
      const contentHash = hash(bytes);
      const reference: StoredObject = {
        contentHash,
        mimeType: input.mimeType,
        visibility: input.visibility,
        byteSize: String(bytes.length),
        storageKey: `${input.visibility.toLowerCase()}/${contentHash}.${storageExtensions[input.mimeType]}`,
      };
      return safely(async () => {
        // raw preserves canonical bytes; overwrite=false protects prior commitments.
        const parameters = {
          overwrite: "false",
          public_id: publicId(reference),
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: "authenticated",
        };
        const payload = Object.entries(parameters)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join("&");
        const form = new FormData();
        for (const [key, value] of Object.entries(parameters)) form.set(key, value);
        form.set("api_key", apiKey);
        form.set(
          "signature",
          createHash("sha256")
            .update(payload + apiSecret)
            .digest("hex"),
        );
        form.set(
          "file",
          new Blob([bytes], { type: input.mimeType }),
          `${contentHash}.${storageExtensions[input.mimeType]}`,
        );
        const response = await request(
          `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
          { method: "POST", body: form },
        );
        if (response.status === 409) {
          await response.body?.cancel();
        } else {
          if (!response.ok) {
            await response.body?.cancel();
            throw new StorageError("IO_FAILURE");
          }
          const result = uploadResponseSchema.safeParse(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                await boundedBody(response, 16_384),
              ),
            ),
          );
          if (
            !result.success ||
            result.data.public_id !== publicId(reference) ||
            result.data.bytes !== bytes.length
          )
            throw new StorageError("INTEGRITY_FAILURE");
        }
        // Also verify deduplicated uploads rather than trusting the provider's response.
        await load(reference);
        return reference;
      });
    },
    async read(reference) {
      const parsed = storedObjectSchema.safeParse(reference);
      if (!parsed.success) throw new StorageError("INVALID_OBJECT");
      return safely(() => load(parsed.data));
    },
  };
}
