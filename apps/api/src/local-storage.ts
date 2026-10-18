import { validateStorageBytes } from "./storage-content.js";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import {
  StorageError,
  storageExtensions,
  storageMimeSchema,
  storageVisibilitySchema,
  storedObjectSchema,
  type StoredObject,
  type StorageProvider,
} from "./storage.js";

export function validStorageRoot(value: string): boolean {
  return (
    value.length <= 4096 &&
    isAbsolute(value) &&
    resolve(value) === value &&
    basename(value) === ".storage" &&
    !value.includes("\0")
  );
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

/** Local development storage; only the trusted API process manages this directory. */
export function createLocalStorageProvider(options: {
  root: string;
  maxBytes?: number;
}): StorageProvider {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  if (
    !validStorageRoot(options.root) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 50 * 1024 * 1024
  )
    throw new StorageError("UNSAFE_PATH");
  const root = options.root;
  async function directory(path: string, create: boolean) {
    // Check every ancestor; O_NOFOLLOW below additionally protects the final file.
    let current = parse(path).root;
    for (const segment of path.slice(current.length).split("/")) {
      current = join(current, segment);
      if (create && (current === root || dirname(current) === root)) {
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
        }
      }
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new StorageError("UNSAFE_PATH");
      if (
        (current === root || dirname(current) === root) &&
        ((stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid()))
      )
        throw new StorageError("UNSAFE_PATH");
    }
  }
  async function load(reference: StoredObject): Promise<Uint8Array> {
    const directoryPath = join(root, reference.visibility.toLowerCase());
    await directory(directoryPath, false);
    const handle = await open(
      join(root, reference.storageKey),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.size > maxBytes ||
        String(stat.size) !== reference.byteSize
      )
        throw new StorageError("INTEGRITY_FAILURE");
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      const bytes = buffer.subarray(0, length);
      if (
        String(bytes.length) !== reference.byteSize ||
        hash(bytes) !== reference.contentHash
      )
        throw new StorageError("INTEGRITY_FAILURE");
      validateStorageBytes(bytes, reference.mimeType, maxBytes);
      return bytes;
    } finally {
      await handle.close();
    }
  }
  function safeError(error: unknown): never {
    if (error instanceof StorageError) throw error;
    if (errorCode(error) === "ENOENT") throw new StorageError("NOT_FOUND");
    if (errorCode(error) === "ELOOP") throw new StorageError("UNSAFE_PATH");
    throw new StorageError("IO_FAILURE");
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
      // Snapshot caller-owned bytes before awaiting; mutations cannot change the stored commitment.
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
      const directoryPath = join(root, input.visibility.toLowerCase());
      const temporary = join(directoryPath, `.pending-${randomUUID()}`);
      let created = false;
      try {
        await directory(directoryPath, true);
        const handle = await open(
          temporary,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        );
        created = true;
        try {
          await handle.writeFile(bytes);
          await handle.sync();
          await handle.chmod(0o400);
        } finally {
          await handle.close();
        }
        // Hard-link publication is atomic and cannot replace an existing hash-addressed object.
        try {
          await link(temporary, join(root, reference.storageKey));
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
        }
        await load(reference);
        return reference;
      } catch (error) {
        safeError(error);
      } finally {
        if (created) await unlink(temporary).catch(() => {});
      }
    },
    async read(reference) {
      const parsed = storedObjectSchema.safeParse(reference);
      if (!parsed.success) throw new StorageError("INVALID_OBJECT");
      try {
        return await load(parsed.data);
      } catch (error) {
        safeError(error);
      }
    },
  };
}
