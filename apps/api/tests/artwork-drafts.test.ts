import { createArtworkMedia } from "../src/artwork-media.js";
import type { ArtworkMediaStore } from "@katha/db";
import { sha256Hex, artworkMediaResponseSchema } from "@katha/shared";
import { StorageError, type StorageProvider } from "../src/storage.js";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ArtworkDraftStore, ArtworkRecord } from "@katha/db";
import {
  artworkDraftListResponseSchema,
  artworkDraftResponseSchema,
  type WalletSession,
} from "@katha/shared";
import { createApi } from "../src/app.js";
import { createArtworkDrafts } from "../src/artwork-drafts.js";
import { createAuthorization } from "../src/authorization.js";
import { createLogger } from "../src/logger.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";
const input = {
  creationRequestId: randomUUID(),
  artistId: randomUUID(),
  category: "PAUBHA",
  title: "Synthetic artwork",
  creationYear: 2026,
};
function fixture(mediaEnabled = false) {
  const now = new Date();
  const record: ArtworkRecord = {
    ...input,
    category: "PAUBHA",
    id: randomUUID(),
    kathaId: "KATHA-PAUBHA-000001",
    publishedAt: null,
    creatorWallet: null,
    authorshipEvidenceHash: null,
    heightMm: null,
    widthMm: null,
    depthMm: null,
    originCountryCode: "NP",
    originRegion: null,
    originLocality: null,
    technique: null,
    story: null,
    meaning: null,
    culturalContext: null,
    creationProcess: null,
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(record, {
    privateEvidence: "PRIVATE-EVIDENCE",
    payoutWallet: "PRIVATE-PAYOUT",
  });
  const store: ArtworkDraftStore = {
    read: vi.fn<ArtworkDraftStore["read"]>(async () => ({
      record,
      materials: [],
      editable: true,
    })),
    list: vi.fn<ArtworkDraftStore["list"]>(async () => [
      {
        id: record.id,
        kathaId: record.kathaId,
        category: record.category,
        title: record.title,
        creationYear: record.creationYear,
        artistId: record.artistId,
        artistName: "Synthetic artist",
        artistVerificationStatus: "UNVERIFIED",
        lifecycleStarted: false,
        createdAt: now,
        updatedAt: now,
      },
    ]),
    update: vi.fn<ArtworkDraftStore["update"]>(async () => ({
      status: "updated",
      record,
    })),
    create: vi.fn<ArtworkDraftStore["create"]>(async () => ({
      status: "created",
      record,
    })),
  };
  const mediaStore: ArtworkMediaStore = {
    read: vi.fn(async () => ({ artwork: record, items: [], editable: true })),
    write: vi.fn<ArtworkMediaStore["write"]>(async (_kathaId, _updatedAt, build) => {
      const values = await build([]);
      return {
        artwork: { ...record, updatedAt: new Date(record.updatedAt.getTime() + 1) },
        editable: true,
        items: values.map((value, position) => ({
          ...value,
          id: value.id ?? randomUUID(),
          artworkId: record.id,
          position,
          role: value.role ?? "OTHER",
          altText: value.altText ?? null,
          caption: value.caption ?? null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        })),
      };
    }),
  };
  const storage: StorageProvider = {
    put: vi.fn(async ({ bytes, mimeType, visibility }) => {
      const contentHash = await sha256Hex(bytes);
      return {
        storageKey: `${visibility.toLowerCase()}/${contentHash}.png`,
        contentHash,
        mimeType,
        visibility,
        byteSize: String(bytes.length),
      };
    }),
    read: vi.fn(async () => new Uint8Array()),
  };
  const admin = temporaryWallet().address;
  const verifier = temporaryWallet().address;
  const session: WalletSession = {
    walletId: randomUUID(),
    walletAddress: admin,
    cluster: "localnet",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const chain = vi.fn(async () => {
    throw new Error("No chain calls for drafts");
  });
  const authorization = createAuthorization(
    {
      authenticate: async (header) => {
        if (header === "Bearer admin") return session;
        if (header === "Bearer verifier")
          return { ...session, walletAddress: verifier };
        if (header === "Bearer outsider")
          return { ...session, walletAddress: temporaryWallet().address };
        throw new DomainError("UNAUTHENTICATED");
      },
    },
    { cluster: "localnet", adminWallets: [admin], verifierWallets: [verifier] },
    chain,
  );
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
    undefined,
    authorization,
    undefined,
    undefined,
    createArtworkDrafts(
      store,
      mediaEnabled ? createArtworkMedia(mediaStore, storage) : undefined,
    ),
  );
  const post = (body: unknown, token?: string) =>
    app.request("/admin/artworks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { app, store, record, post, logs, chain, mediaStore, storage };
}
it("creates a private draft with server identity and nullable content", async () => {
  const f = fixture();
  const response = await f.post(input, "admin");
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result = artworkDraftResponseSchema.parse(await response.json());
  expect(result).toMatchObject({
    id: f.record.id,
    kathaId: f.record.kathaId,
    creatorWallet: null,
    dimensions: null,
    origin: { countryCode: "NP", region: null, locality: null },
  });
  expect(result).not.toHaveProperty("creationRequestId");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(f.chain).not.toHaveBeenCalled();
  expect(f.logs.join("")).not.toContain(input.title);
});
it.each([undefined, "verifier", "outsider"])(
  "denies %s before storage",
  async (token) => {
    const f = fixture();
    expect((await f.post(input, token)).status).toBe(token ? 403 : 401);
    expect(f.store.create).not.toHaveBeenCalled();
  },
);
it.each([
  { artistId: "invalid" },
  { creationRequestId: "invalid" },
  { category: "NFT" },
  { title: " " },
  { title: "bad\u0000title" },
  { creationYear: "2026" },
  { dimensions: { heightMm: 10 } },
  { dimensions: { heightMm: 10, widthMm: 2147483648 } },
  { origin: { countryCode: "np" } },
  { story: " " },
  { authorshipEvidenceHash: "invalid" },
  { id: randomUUID() },
  { kathaId: "KATHA-PAUBHA-000002" },
  { creatorWallet: temporaryWallet().address },
  { verificationStatus: "VERIFIED" },
  { privateEvidence: "secret" },
  { materials: ["gold, silk"] },
  { publishedAt: new Date().toISOString() },
])("rejects malformed or privileged creation %j", async (invalid) => {
  const f = fixture();
  expect((await f.post({ ...input, ...invalid }, "admin")).status).toBe(400);
  expect(f.store.create).not.toHaveBeenCalled();
});
it("normalizes full draft content without accepting identity overrides", async () => {
  const f = fixture();
  const body = {
    ...input,
    artistId: input.artistId.toUpperCase(),
    dimensions: { heightMm: 300, widthMm: 200 },
    origin: { countryCode: "NP", region: "Patan" },
    story: "Synthetic story",
    authorshipEvidenceHash: "a".repeat(64),
  };
  expect((await f.post(body, "admin")).status).toBe(201);
  expect(f.store.create).toHaveBeenCalledWith(
    expect.objectContaining({
      artistId: input.artistId,
      heightMm: 300,
      widthMm: 200,
      depthMm: null,
      originLocality: null,
      story: body.story,
      authorshipEvidenceHash: body.authorshipEvidenceHash,
    }),
  );
});
it.each([
  ["artist_not_found", 404],
  ["duplicate", 409],
  ["capacity_exhausted", 409],
] as const)("maps %s to %s", async (status, expected) => {
  const f = fixture();
  vi.mocked(f.store.create).mockResolvedValue({ status });
  expect((await f.post(input, "admin")).status).toBe(expected);
});
it("redacts unexpected database errors", async () => {
  const f = fixture();
  vi.mocked(f.store.create).mockRejectedValue(new Error("PRIVATE-DATABASE-URL"));
  const response = await f.post(input, "admin");
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(f.logs.join("")).not.toContain("PRIVATE");
});
it("denies the real draft route when authorization wiring is missing", async () => {
  const f = fixture();
  const app = createApi(
    createLogger(() => {}),
    undefined,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    createArtworkDrafts(f.store),
  );
  expect(
    (
      await app.request("/admin/artworks", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(401);
  expect(f.store.create).not.toHaveBeenCalled();
});

function patch(
  f: ReturnType<typeof fixture>,
  body: unknown,
  token?: string,
  kathaId = f.record.kathaId,
) {
  return f.app.request(`/admin/artworks/${kathaId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
it("edits selected draft content with explicit null clearing and no identity overrides", async () => {
  const f = fixture();
  const expectedUpdatedAt = f.record.updatedAt.toISOString();
  const updatedAt = new Date(f.record.updatedAt.getTime() + 1);
  vi.mocked(f.store.update).mockResolvedValue({
    status: "updated",
    record: { ...f.record, title: "Revised synthetic title", updatedAt },
  });
  const response = await patch(
    f,
    {
      expectedUpdatedAt,
      title: "Revised synthetic title",
      dimensions: null,
      story: null,
      origin: { countryCode: "NP", region: "Patan" },
    },
    "admin",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result = artworkDraftResponseSchema.parse(await response.json());
  expect(result).toMatchObject({
    id: f.record.id,
    kathaId: f.record.kathaId,
    artistId: f.record.artistId,
    creatorWallet: null,
    creationYear: f.record.creationYear,
    title: "Revised synthetic title",
    updatedAt: updatedAt.toISOString(),
  });
  expect(f.store.update).toHaveBeenCalledWith(
    f.record.kathaId,
    expectedUpdatedAt,
    expect.objectContaining({
      title: "Revised synthetic title",
      heightMm: null,
      widthMm: null,
      depthMm: null,
      story: null,
      originCountryCode: "NP",
      originRegion: "Patan",
      originLocality: null,
      technique: undefined,
    }),
  );
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(f.chain).not.toHaveBeenCalled();
  expect(f.logs.join("")).not.toContain("Revised synthetic title");
});
it.each([undefined, "verifier", "outsider"])(
  "denies draft edits by %s before persistence",
  async (token) => {
    const f = fixture();
    expect(
      (
        await patch(
          f,
          { expectedUpdatedAt: f.record.updatedAt.toISOString(), title: "Edited" },
          token,
        )
      ).status,
    ).toBe(token ? 403 : 401);
    expect(f.store.update).not.toHaveBeenCalled();
  },
);
it.each([
  {},
  { expectedUpdatedAt: "invalid", title: "Edited" },
  { title: " " },
  { dimensions: { widthMm: 100 } },
  { dimensions: { heightMm: 1, widthMm: 1.2 } },
  { origin: null },
  { origin: { countryCode: "np" } },
  { story: "\u0000" },
  { id: randomUUID() },
  { artistId: randomUUID() },
  { kathaId: "KATHA-PAUBHA-000002" },
  { category: "MANDALA" },
  { creatorWallet: temporaryWallet().address },
  { creationYear: 2025 },
  { createdAt: new Date().toISOString() },
  { updatedAt: new Date().toISOString() },
  { creationRequestId: randomUUID() },
  { verificationStatus: "VERIFIED" },
  { materials: ["Gold", "gold"] },
  { privateEvidence: "secret" },
  { publishedAt: new Date().toISOString() },
])("rejects invalid or privileged edit %j before persistence", async (invalid) => {
  const f = fixture();
  const body = { expectedUpdatedAt: f.record.updatedAt.toISOString(), ...invalid };
  expect((await patch(f, body, "admin")).status).toBe(400);
  expect(f.store.update).not.toHaveBeenCalled();
});
it("rejects a missing version or malformed permanent path", async () => {
  const f = fixture();
  expect((await patch(f, { title: "Edited" }, "admin")).status).toBe(400);
  expect(
    (
      await patch(
        f,
        { expectedUpdatedAt: f.record.updatedAt.toISOString(), title: "Edited" },
        "admin",
        "bad-id",
      )
    ).status,
  ).toBe(400);
  expect(f.store.update).not.toHaveBeenCalled();
});
it.each([
  ["not_found", 404],
  ["conflict", 409],
] as const)("maps edit result %s safely", async (status, expected) => {
  const f = fixture();
  vi.mocked(f.store.update).mockResolvedValue({ status });
  expect(
    (
      await patch(
        f,
        { expectedUpdatedAt: f.record.updatedAt.toISOString(), title: "Edited" },
        "admin",
      )
    ).status,
  ).toBe(expected);
});
it("redacts edit storage failures", async () => {
  const f = fixture();
  vi.mocked(f.store.update).mockRejectedValue(new Error("PRIVATE-DATABASE-URL"));
  const response = await patch(
    f,
    { expectedUpdatedAt: f.record.updatedAt.toISOString(), title: "Edited" },
    "admin",
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(f.logs.join("")).not.toContain("PRIVATE");
});

it("lists safe draft summaries only after admin authorization with strict pagination", async () => {
  const f = fixture();
  for (const [token, status] of [
    [undefined, 401],
    ["outsider", 403],
    ["verifier", 403],
    ["admin", 200],
  ] as const) {
    const result = await f.app.request("/admin/artworks?limit=1&offset=0", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(result.status).toBe(status);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    const body = await result.json();
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    if (status === 200) {
      const page = artworkDraftListResponseSchema.parse(body);
      expect(page.items[0]?.workflowStatus).toBe("DOCUMENTING");
      expect(page.items[0]?.artist.verificationStatus).toBe("UNVERIFIED");
      expect(page.pagination).toEqual({ limit: 1, offset: 0, hasMore: false });
    }
  }
  expect(f.store.list).toHaveBeenCalledTimes(1);
  expect(f.store.list).toHaveBeenCalledWith({ limit: 1, offset: 0 });
  for (const query of [
    "limit=0",
    "offset=-1",
    "limit=101",
    "offset=100001",
    "limit=1&limit=2",
    "wallet=admin",
  ])
    expect(
      (
        await f.app.request(`/admin/artworks?${query}`, {
          headers: { Authorization: "Bearer admin" },
        })
      ).status,
    ).toBe(400);
  vi.mocked(f.store.list).mockRejectedValueOnce(new Error("PRIVATE_DRIVER_SENTINEL"));
  const failed = await f.app.request("/admin/artworks", {
    headers: { Authorization: "Bearer admin" },
  });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("PRIVATE_DRIVER_SENTINEL");
  expect(f.chain).not.toHaveBeenCalled();
});

it("reads draft content only for administrators, projecting materials and editing eligibility", async () => {
  const f = fixture();
  for (const token of [undefined, "verifier", "outsider", "admin"]) {
    const result = await f.app.request(`/admin/artworks/${f.record.kathaId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(result.status).toBe(token === "admin" ? 200 : token ? 403 : 401);
    if (token === "admin") {
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      const body = await result.json();
      expect(body).toMatchObject({
        editable: true,
        artwork: { kathaId: f.record.kathaId, materials: [] },
      });
      expect(JSON.stringify(body)).not.toContain("PRIVATE");
    }
  }
  expect(f.store.read).toHaveBeenCalledTimes(1);
  f.store.read = vi.fn(async () => null);
  expect(
    (
      await f.app.request(`/admin/artworks/${f.record.kathaId}`, {
        headers: { Authorization: "Bearer admin" },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await f.app.request("/admin/artworks/invalid", {
        headers: { Authorization: "Bearer admin" },
      })
    ).status,
  ).toBe(400);
  f.store.read = vi.fn(async () => {
    throw new Error("PRIVATE_DRIVER_ERROR");
  });
  const failed = await f.app.request(`/admin/artworks/${f.record.kathaId}`, {
    headers: { Authorization: "Bearer admin" },
  });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("PRIVATE_DRIVER_ERROR");
});

function mediaForm(expectedUpdatedAt: string, patch = {}) {
  const data = new FormData();
  data.set(
    "metadata",
    JSON.stringify({
      expectedUpdatedAt,
      mimeType: "image/png",
      role: "FRONT",
      visibility: "PRIVATE",
      altText: "Synthetic photograph",
      caption: null,
      approvedPublic: false,
      ...patch,
    }),
  );
  data.set(
    "file",
    new File([new Uint8Array([1, 2, 3])], "PRIVATE_ORIGINAL_NAME.png", {
      type: "image/png",
    }),
  );
  return data;
}
it("authorizes all media routes before persistence or provider access", async () => {
  const f = fixture(true);
  for (const token of [undefined, "verifier", "outsider", "admin"]) {
    const response = await f.app.request(`/admin/artworks/${f.record.kathaId}/media`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: mediaForm(f.record.updatedAt.toISOString()),
    });
    expect(response.status).toBe(token === "admin" ? 201 : token ? 403 : 401);
    if (token === "admin") {
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(
        artworkMediaResponseSchema.parse(await response.json()).items[0]?.visibility,
      ).toBe("PRIVATE");
    }
  }
  expect(f.mediaStore.write).toHaveBeenCalledTimes(1);
  expect(f.storage.put).toHaveBeenCalledTimes(1);
  expect(f.logs.join("")).not.toContain("PRIVATE_ORIGINAL_NAME");
  for (const method of ["GET", "PATCH"]) {
    const response = await f.app.request(`/admin/artworks/${f.record.kathaId}/media`, {
      method,
      headers: { Authorization: "Bearer verifier", "Content-Type": "application/json" },
      ...(method === "PATCH" ? { body: "{}" } : {}),
    });
    expect(response.status).toBe(403);
  }
});
it("rejects malformed multipart, forged publication, duplicate fields and provider failures safely", async () => {
  const f = fixture(true);
  const url = `/admin/artworks/${f.record.kathaId}/media`;
  for (const patch of [
    { visibility: "PUBLIC" },
    { mimeType: "image/svg+xml" },
    { role: "CONDITION", visibility: "PUBLIC", approvedPublic: true },
    { storageKey: "public/forged.png" },
  ]) {
    expect(
      (
        await f.app.request(url, {
          method: "POST",
          headers: { Authorization: "Bearer admin" },
          body: mediaForm(f.record.updatedAt.toISOString(), patch),
        })
      ).status,
    ).toBe(400);
  }
  const duplicate = mediaForm(f.record.updatedAt.toISOString());
  duplicate.append("file", new File(["private"], "private.png"));
  expect(
    (
      await f.app.request(url, {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: duplicate,
      })
    ).status,
  ).toBe(400);
  const oversized = mediaForm(f.record.updatedAt.toISOString());
  oversized.set(
    "file",
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], "oversized.png", {
      type: "image/png",
    }),
  );
  expect(
    (
      await f.app.request(url, {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: oversized,
      })
    ).status,
  ).toBe(413);
  expect(f.mediaStore.write).not.toHaveBeenCalled();
  expect(f.storage.put).not.toHaveBeenCalled();
  f.storage.put = vi.fn(async () => {
    throw new StorageError("INVALID_OBJECT");
  });
  expect(
    (
      await f.app.request(url, {
        method: "POST",
        headers: { Authorization: "Bearer admin" },
        body: mediaForm(f.record.updatedAt.toISOString()),
      })
    ).status,
  ).toBe(400);
  f.storage.put = vi.fn(async () => {
    throw new Error("PRIVATE_FILESYSTEM_PATH");
  });
  const failure = await f.app.request(url, {
    method: "POST",
    headers: { Authorization: "Bearer admin" },
    body: mediaForm(f.record.updatedAt.toISOString()),
  });
  expect(failure.status).toBe(500);
  expect(await failure.text()).not.toContain("PRIVATE_FILESYSTEM_PATH");
});
