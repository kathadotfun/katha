import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readServerConfiguration } from "../src/config.js";
import { createStorageProvider } from "../src/storage-provider.js";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("retains local storage unless Cloudinary is explicitly selected", async () => {
  const parent = await mkdtemp(join(tmpdir(), "katha-storage-selection-"));
  directories.push(parent);
  const root = join(parent, ".storage");
  const send = vi.spyOn(globalThis, "fetch");
  const provider = createStorageProvider(
    readServerConfiguration({
      DATABASE_URL: "postgres://synthetic:password@localhost/test",
      KATHA_STORAGE_ROOT: root,
      CLOUDINARY_CLOUD_NAME: "synthetic-cloud",
      CLOUDINARY_API_KEY: "123456",
      CLOUDINARY_API_SECRET: "synthetic-secret",
    }),
  );
  const bytes = Buffer.from('{"synthetic":true}');
  const ref = await provider.put({
    bytes,
    mimeType: "application/json",
    visibility: "PRIVATE",
  });
  expect(await provider.read(ref)).toEqual(bytes);
  expect((await stat(join(root, ref.storageKey))).isFile()).toBe(true);
  expect(send).not.toHaveBeenCalled();
});

it("selects Cloudinary without reading or writing local storage", async () => {
  const parent = await mkdtemp(join(tmpdir(), "katha-storage-selection-"));
  directories.push(parent);
  const root = join(parent, ".storage");
  const send = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 404 }));
  const provider = createStorageProvider(
    readServerConfiguration({
      DATABASE_URL: "postgres://synthetic:password@localhost/test",
      KATHA_STORAGE_ROOT: root,
      KATHA_STORAGE_PROVIDER: "cloudinary",
      CLOUDINARY_CLOUD_NAME: "synthetic-cloud",
      CLOUDINARY_API_KEY: "123456",
      CLOUDINARY_API_SECRET: "synthetic-secret",
    }),
  );
  await expect(
    provider.read({
      storageKey: `private/${"a".repeat(64)}.json`,
      contentHash: "a".repeat(64),
      mimeType: "application/json",
      visibility: "PRIVATE",
      byteSize: "1",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(String(send.mock.calls[0]![0])).toMatch(
    /^https:\/\/res\.cloudinary\.com\/synthetic-cloud\/raw\/authenticated\//,
  );
  await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
});
