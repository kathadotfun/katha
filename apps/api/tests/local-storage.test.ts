import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  rm,
  readdir,
  readFile,
  chmod,
  writeFile,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createLocalStorageProvider } from "../src/local-storage.js";
import {
  storedObjectSchema,
  type StorageMime,
  type StorageVisibility,
} from "../src/storage.js";
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const json = new TextEncoder().encode('{"title":"Synthetic artwork"}');
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1l8AAAAASUVORK5CYII=",
  "base64",
);
async function fixture(maxBytes?: number) {
  const base = await mkdtemp(join(tmpdir(), "katha-storage-"));
  temporary.push(base);
  const root = join(base, ".storage");
  return {
    root,
    base,
    provider: createLocalStorageProvider({
      root,
      ...(maxBytes === undefined ? {} : { maxBytes }),
    }),
  };
}
it("hashes exact bytes and persists across provider restart with private permissions", async () => {
  const { root, provider } = await fixture();
  const object = await provider.put({
    bytes: json,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  expect(object.contentHash).toBe(createHash("sha256").update(json).digest("hex"));
  expect(object.byteSize).toBe(String(json.length));
  expect(storedObjectSchema.parse(object)).toEqual(object);
  expect(await createLocalStorageProvider({ root }).read(object)).toEqual(
    Buffer.from(json),
  );
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, object.storageKey))).mode & 0o777).toBe(0o400);
  expect(await readdir(join(root, "private"))).toEqual([
    object.storageKey.split("/")[1],
  ]);
});
it("deduplicates concurrent writes without replacing bytes or leaving temporary files", async () => {
  const { root, provider } = await fixture();
  const refs = await Promise.all(
    Array.from({ length: 12 }, () =>
      provider.put({ bytes: png, mimeType: "image/png", visibility: "PUBLIC" }),
    ),
  );
  expect(new Set(refs.map((ref) => ref.storageKey)).size).toBe(1);
  expect(await readFile(join(root, refs[0]!.storageKey))).toEqual(png);
  expect(await readdir(join(root, "public"))).toHaveLength(1);
});
it("isolates identical public/private bytes and never falls back across visibility", async () => {
  const { provider } = await fixture();
  const privateRef = await provider.put({
    bytes: json,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  await expect(
    provider.read({
      ...privateRef,
      visibility: "PUBLIC",
      storageKey: privateRef.storageKey.replace("private/", "public/"),
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const publicRef = await provider.put({
    bytes: json,
    mimeType: "application/json",
    visibility: "PUBLIC",
  });
  expect(publicRef.contentHash).toBe(privateRef.contentHash);
  expect(publicRef.storageKey).not.toBe(privateRef.storageKey);
  expect(await provider.read(privateRef)).toEqual(await provider.read(publicRef));
});
it.each([
  "../secret",
  "/etc/passwd",
  "public/../../secret",
  "public/%2e%2e/secret",
  "private/not-a-hash.json",
])("rejects forged storage key %s", async (storageKey) => {
  const { provider } = await fixture();
  const ref = await provider.put({
    bytes: json,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  await expect(provider.read({ ...ref, storageKey })).rejects.toMatchObject({
    code: "INVALID_OBJECT",
  });
});
it.each([
  { bytes: new Uint8Array(), mimeType: "application/json" as const },
  {
    bytes: new TextEncoder().encode("not JSON"),
    mimeType: "application/json" as const,
  },
  { bytes: new TextEncoder().encode("[]"), mimeType: "application/json" as const },
  { bytes: new Uint8Array([255, 255]), mimeType: "application/json" as const },
  { bytes: json, mimeType: "image/png" as const },
  { bytes: png, mimeType: "image/jpeg" as const },
])("rejects empty or mismatched object %j", async (input) => {
  const { root, provider } = await fixture();
  await expect(provider.put({ ...input, visibility: "PRIVATE" })).rejects.toMatchObject(
    { code: "INVALID_OBJECT" },
  );
  await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
});
it("rejects unsupported MIME and visibility at runtime", async () => {
  const { provider } = await fixture();
  await expect(
    provider.put({
      bytes: json,
      mimeType: "image/svg+xml" as StorageMime,
      visibility: "PRIVATE",
    }),
  ).rejects.toMatchObject({ code: "INVALID_OBJECT" });
  await expect(
    provider.put({
      bytes: json,
      mimeType: "application/json",
      visibility: "VISIBLE" as StorageVisibility,
    }),
  ).rejects.toMatchObject({ code: "INVALID_OBJECT" });
});
it("enforces object and JSON document limits before creating files", async () => {
  const { provider } = await fixture(4);
  await expect(
    provider.put({ bytes: json, mimeType: "application/json", visibility: "PRIVATE" }),
  ).rejects.toMatchObject({ code: "TOO_LARGE" });
  const larger = await fixture(2 * 1024 * 1024);
  await expect(
    larger.provider.put({
      bytes: new Uint8Array(1024 * 1024 + 1),
      mimeType: "application/json",
      visibility: "PRIVATE",
    }),
  ).rejects.toMatchObject({ code: "TOO_LARGE" });
});
it("detects tampering on read and refuses an overwrite disguised as deduplication", async () => {
  const { root, provider } = await fixture();
  const ref = await provider.put({
    bytes: json,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  const path = join(root, ref.storageKey);
  await chmod(path, 0o600);
  await writeFile(path, "x".repeat(json.length));
  await expect(provider.read(ref)).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  await expect(
    provider.put({ bytes: json, mimeType: "application/json", visibility: "PRIVATE" }),
  ).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  expect(await readFile(path, "utf8")).toBe("x".repeat(json.length));
  expect(await readdir(join(root, "private"))).toHaveLength(1);
});
it.each(["root", "namespace", "file", "ancestor"])(
  "rejects symlink %s without accessing its target",
  async (location) => {
    const { root, base, provider } = await fixture();
    const outside = join(base, "outside");
    await mkdir(outside);
    if (location === "ancestor") {
      const alias = join(base, "alias");
      await symlink(outside, alias);
      await expect(
        createLocalStorageProvider({ root: join(alias, ".storage") }).put({
          bytes: json,
          mimeType: "application/json",
          visibility: "PRIVATE",
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    } else if (location === "root" || location === "namespace") {
      if (location === "namespace") await mkdir(root, { mode: 0o700 });
      await symlink(outside, location === "root" ? root : join(root, "private"));
      await expect(
        provider.put({
          bytes: json,
          mimeType: "application/json",
          visibility: "PRIVATE",
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    } else {
      const ref = await provider.put({
        bytes: json,
        mimeType: "application/json",
        visibility: "PRIVATE",
      });
      const target = join(outside, "secret");
      await writeFile(target, json);
      await rm(join(root, ref.storageKey));
      await symlink(target, join(root, ref.storageKey));
      await expect(provider.read(ref)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
      await expect(
        provider.put({
          bytes: json,
          mimeType: "application/json",
          visibility: "PRIVATE",
        }),
      ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
    }
    expect(await readdir(outside)).toEqual(location === "file" ? ["secret"] : []);
  },
);
it("rejects writable-by-others storage directories", async () => {
  const { root, provider } = await fixture();
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o777);
  await expect(
    provider.put({ bytes: json, mimeType: "application/json", visibility: "PRIVATE" }),
  ).rejects.toMatchObject({ code: "UNSAFE_PATH" });
});
it("rejects mismatched reference size and MIME before returning content", async () => {
  const { provider } = await fixture();
  const ref = await provider.put({
    bytes: json,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  await expect(provider.read({ ...ref, byteSize: "1" })).rejects.toMatchObject({
    code: "INTEGRITY_FAILURE",
  });
  await expect(provider.read({ ...ref, mimeType: "image/png" })).rejects.toMatchObject({
    code: "INVALID_OBJECT",
  });
});

it.each([
  ["image/jpeg", Buffer.from([255, 216, 255, 224, 0, 2, 255, 217])],
  ["image/webp", Buffer.from("RIFF1234WEBPVP8 ", "ascii")],
  ["image/avif", Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypavif0000")])],
  ["video/mp4", Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypisom0000")])],
  ["video/webm", Buffer.from([26, 69, 223, 163, ...Buffer.from("webm")])],
  ["application/pdf", Buffer.from("%PDF-1.7\nSynthetic test document\n%%EOF")],
] as const)(
  "recognizes supported %s signatures and checks stored bytes",
  async (mimeType, bytes) => {
    const { provider } = await fixture();
    const ref = await provider.put({ bytes, mimeType, visibility: "PRIVATE" });
    expect(ref.mimeType).toBe(mimeType);
    expect(await provider.read(ref)).toEqual(bytes);
  },
);
it("snapshots caller-owned bytes before asynchronous writes", async () => {
  const { provider } = await fixture();
  const bytes = Uint8Array.from(json);
  const pending = provider.put({
    bytes,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  bytes.fill(120);
  const ref = await pending;
  expect(await provider.read(ref)).toEqual(Buffer.from(json));
});
it("returns a path-free missing-object error", async () => {
  const { provider } = await fixture();
  await expect(
    provider.read({
      storageKey: `private/${"a".repeat(64)}.json`,
      contentHash: "a".repeat(64),
      byteSize: "1",
      mimeType: "application/json",
      visibility: "PRIVATE",
    }),
  ).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "Storage operation failed: NOT_FOUND",
  });
});
