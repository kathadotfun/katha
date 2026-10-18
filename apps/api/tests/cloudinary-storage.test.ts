import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createCloudinaryStorageProvider } from "../src/cloudinary-storage.js";
import type { StorageMime, StorageVisibility, StoredObject } from "../src/storage.js";

const credentials = {
  cloudName: "synthetic-cloud",
  apiKey: "123456",
  apiSecret: "synthetic-secret",
};
const json = new TextEncoder().encode('{"synthetic":true}');
const input = {
  bytes: json,
  mimeType: "application/json" as const,
  visibility: "PRIVATE" as const,
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function reference(): StoredObject {
  return {
    contentHash: digest(json),
    storageKey: `private/${digest(json)}.json`,
    mimeType: "application/json",
    visibility: "PRIVATE",
    byteSize: String(json.length),
  };
}
function fixture() {
  const objects = new Map<string, Uint8Array>();
  const uploads: FormData[] = [];
  const urls: string[] = [];
  const send = vi.fn<typeof fetch>(async (target, options) => {
    const url = new URL(String(target));
    urls.push(url.toString());
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    if (options?.method === "POST") {
      expect(url.toString()).toBe(
        "https://api.cloudinary.com/v1_1/synthetic-cloud/raw/upload",
      );
      const form = options.body as FormData;
      uploads.push(form);
      expect(form.get("type")).toBe("authenticated");
      expect(form.get("overwrite")).toBe("false");
      expect(form.get("api_secret")).toBeNull();
      const file = form.get("file") as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = String(form.get("public_id"));
      if (!objects.has(id)) objects.set(id, bytes);
      return Response.json({
        public_id: id,
        bytes: bytes.length,
        type: "authenticated",
        resource_type: "raw",
        secure_url: "https://untrusted.example/ignored",
      });
    }
    expect(url.origin).toBe("https://res.cloudinary.com");
    const match =
      /^\/synthetic-cloud\/raw\/authenticated\/s--([^/]+)--\/v1\/(katha\/(public|private)\/[a-f0-9]{64}\.json)$/.exec(
        url.pathname,
      );
    expect(match).not.toBeNull();
    const id = match![2]!;
    expect(match![1]).toBe(
      createHash("sha256")
        .update(id + credentials.apiSecret)
        .digest("base64url")
        .slice(0, 8),
    );
    const bytes = objects.get(id);
    return bytes
      ? new Response(Buffer.from(bytes))
      : new Response(null, { status: 404 });
  });
  return {
    objects,
    uploads,
    urls,
    send,
    provider: createCloudinaryStorageProvider({ ...credentials, fetch: send }),
  };
}

it("stores authenticated raw originals, verifies exact bytes and deduplicates without overwrite", async () => {
  const { provider, uploads, objects } = fixture();
  const refs = await Promise.all([provider.put(input), provider.put(input)]);
  expect(refs[0]).toEqual(refs[1]);
  expect(refs[0]).toEqual(reference());
  expect(await provider.read(refs[0]!)).toEqual(Buffer.from(json));
  expect(objects.size).toBe(1);
  expect(uploads).toHaveLength(2);
  const form = uploads[0]!;
  const message = `overwrite=false&public_id=katha/${reference().storageKey}&timestamp=${form.get("timestamp")}&type=authenticated${credentials.apiSecret}`;
  expect(form.get("signature")).toBe(
    createHash("sha256").update(message).digest("hex"),
  );
  expect(JSON.stringify(refs)).not.toContain(credentials.apiSecret);
  expect(JSON.stringify(refs)).not.toContain("cloudinary");
});
it("isolates identical public/private bytes and never falls back across visibility", async () => {
  const { provider, objects } = fixture();
  const privateRef = await provider.put(input);
  const publicRef = {
    ...privateRef,
    visibility: "PUBLIC" as const,
    storageKey: privateRef.storageKey.replace("private/", "public/"),
  };
  await expect(provider.read(publicRef)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await provider.put({ ...input, visibility: "PUBLIC" })).toEqual(publicRef);
  expect(objects.size).toBe(2);
  expect(await provider.read(publicRef)).toEqual(await provider.read(privateRef));
});
it("snapshots caller-owned bytes before awaiting network I/O", async () => {
  const { provider } = fixture();
  const bytes = Uint8Array.from(json);
  const pending = provider.put({ ...input, bytes });
  bytes.fill(120);
  expect(await provider.read(await pending)).toEqual(Buffer.from(json));
});
it("rejects changed deduplicated objects rather than overwriting them", async () => {
  const { provider, objects } = fixture();
  const ref = await provider.put(input);
  objects.set(`katha/${ref.storageKey}`, new Uint8Array(json.length).fill(120));
  await expect(provider.read(ref)).rejects.toMatchObject({ code: "INTEGRITY_FAILURE" });
  await expect(provider.put(input)).rejects.toMatchObject({
    code: "INTEGRITY_FAILURE",
  });
  expect(objects.get(`katha/${ref.storageKey}`)).not.toEqual(Buffer.from(json));
});
it.each([
  "../secret",
  "public/%2e%2e/secret",
  "private/not-a-hash.json",
  "https://evil.example/file",
])("rejects forged storage reference %s before networking", async (storageKey) => {
  const { provider, send } = fixture();
  await expect(provider.read({ ...reference(), storageKey })).rejects.toMatchObject({
    code: "INVALID_OBJECT",
  });
  expect(send).not.toHaveBeenCalled();
});
it.each([
  { ...input, bytes: new Uint8Array() },
  { ...input, bytes: new TextEncoder().encode("[]") },
  { ...input, mimeType: "image/png" as StorageMime },
  { ...input, mimeType: "image/svg+xml" as StorageMime },
  { ...input, visibility: "VISIBLE" as StorageVisibility },
])("rejects invalid content before uploading", async (data) => {
  const { provider, send } = fixture();
  await expect(provider.put(data)).rejects.toMatchObject({ code: "INVALID_OBJECT" });
  expect(send).not.toHaveBeenCalled();
});
it("enforces upload, JSON and reference limits before networking", async () => {
  const send = vi.fn<typeof fetch>();
  const provider = createCloudinaryStorageProvider({
    ...credentials,
    maxBytes: 4,
    fetch: send,
  });
  await expect(provider.put(input)).rejects.toMatchObject({ code: "TOO_LARGE" });
  await expect(provider.read(reference())).rejects.toMatchObject({ code: "TOO_LARGE" });
  const larger = createCloudinaryStorageProvider({
    ...credentials,
    maxBytes: 2 * 1024 * 1024,
    fetch: send,
  });
  await expect(
    larger.put({ ...input, bytes: new Uint8Array(1024 * 1024 + 1) }),
  ).rejects.toMatchObject({ code: "TOO_LARGE" });
  expect(send).not.toHaveBeenCalled();
});
it.each([
  {
    public_id: "wrong",
    type: "authenticated",
    resource_type: "raw",
    bytes: json.length,
  },
  {
    public_id: `katha/${reference().storageKey}`,
    type: "upload",
    resource_type: "raw",
    bytes: json.length,
  },
  {
    public_id: `katha/${reference().storageKey}`,
    type: "authenticated",
    resource_type: "image",
    bytes: json.length,
  },
  {
    public_id: `katha/${reference().storageKey}`,
    type: "authenticated",
    resource_type: "raw",
    bytes: 1,
  },
])("rejects mismatched provider upload metadata", async (result) => {
  const send = vi.fn<typeof fetch>(async () => Response.json(result));
  const provider = createCloudinaryStorageProvider({ ...credentials, fetch: send });
  await expect(provider.put(input)).rejects.toMatchObject({
    code: "INTEGRITY_FAILURE",
  });
  expect(send).toHaveBeenCalledTimes(1);
});
it.each([401, 403, 429, 500])("redacts provider failure %i", async (status) => {
  const provider = createCloudinaryStorageProvider({
    ...credentials,
    fetch: async () => new Response(credentials.apiSecret, { status }),
  });
  for (const operation of [
    () => provider.put(input),
    () => provider.read(reference()),
  ]) {
    await expect(operation()).rejects.toMatchObject({
      message: "Storage operation failed: IO_FAILURE",
      code: "IO_FAILURE",
    });
  }
});
it("redacts network, redirect and body-stream exceptions", async () => {
  for (const send of [
    async () => {
      throw new Error(credentials.apiSecret);
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(credentials.apiSecret));
          },
        }),
      ),
  ]) {
    const provider = createCloudinaryStorageProvider({ ...credentials, fetch: send });
    await expect(provider.read(reference())).rejects.toMatchObject({
      message: "Storage operation failed: IO_FAILURE",
    });
  }
});
it.each(["oversize-header", "oversize-stream", "truncated", "wrong-content"])(
  "rejects %s downloads",
  async (kind) => {
    const bytes =
      kind === "oversize-stream"
        ? new Uint8Array(json.length + 1)
        : kind === "truncated"
          ? json.subarray(0, 1)
          : new Uint8Array(json.length);
    const provider = createCloudinaryStorageProvider({
      ...credentials,
      fetch: async () =>
        new Response(
          bytes,
          kind === "oversize-header"
            ? { headers: { "content-length": String(json.length + 1) } }
            : {},
        ),
    });
    await expect(provider.read(reference())).rejects.toMatchObject({
      code: "INTEGRITY_FAILURE",
    });
  },
);
it("verifies existing bytes after a duplicate-upload conflict", async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(new Response(json));
  expect(
    await createCloudinaryStorageProvider({ ...credentials, fetch: send }).put(input),
  ).toEqual(reference());
});
it.each([
  { cloudName: "../evil" },
  { cloudName: "https://evil.example" },
  { apiKey: "not-numeric" },
  { apiSecret: "" },
  { apiSecret: "with whitespace" },
  { maxBytes: 0 },
  { maxBytes: 50 * 1024 * 1024 + 1 },
])("rejects unsafe provider settings without exposing them", (change) => {
  expect(() => createCloudinaryStorageProvider({ ...credentials, ...change })).toThrow(
    "Storage operation failed: INVALID_OBJECT",
  );
});
