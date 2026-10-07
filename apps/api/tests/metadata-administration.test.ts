import { createApi } from "../src/app.js";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  canonicalDocumentBytes,
  metadataDocumentSchema,
  sha256Hex,
} from "@katha/shared";
import type { MetadataAdministrationStore, MetadataRevisionStore } from "@katha/db";
import {
  getMetadataHeadDecoder,
  getMetadataHeadEncoder,
  getMetadataRevisionDecoder,
  getMetadataRevisionEncoder,
} from "@katha/solana/registry";
import { metadataRevisionFixture } from "./fixtures/metadata-revision.js";
import { createMetadataAdministration } from "../src/metadata-administration.js";
import { createMetadataRevisions } from "../src/metadata-revisions.js";
import type { StorageProvider } from "../src/storage.js";
async function fixture(mode: "INITIALIZE" | "UNMINTED" | "MINTED" = "MINTED") {
  const f = await metadataRevisionFixture(mode),
    docs = new Map<string, Uint8Array>();
  docs.set(
    f.snapshot.metadata!.documentHash!,
    new TextEncoder().encode(f.snapshot.metadata!.canonicalDocument!),
  );
  const original = metadataDocumentSchema.parse(
    JSON.parse(f.snapshot.metadata!.canonicalDocument!),
  );
  const oldBytes = canonicalDocumentBytes({
      ...original,
      publicContent: { ...original.publicContent, story: "Previous approved story" },
    }),
    oldHash = await sha256Hex(oldBytes);
  docs.set(oldHash, oldBytes);
  const current =
    mode === "INITIALIZE"
      ? null
      : {
          ...f.snapshot.metadata!,
          id: randomUUID(),
          status: "FINALIZED" as const,
          chainVersion: 1,
          chainCluster: "LOCALNET" as const,
          canonicalDocument: new TextDecoder().decode(oldBytes),
          documentHash: oldHash,
          uri: f.oldUri,
        };
  if (f.accounts.mode !== "INITIALIZE") {
    const head = getMetadataHeadDecoder().decode(f.accounts.metadataHeadAccount.data);
    f.accounts.metadataHeadAccount = {
      ...f.accounts.metadataHeadAccount,
      data: Uint8Array.from(
        getMetadataHeadEncoder().encode({
          ...head,
          currentHash: Buffer.from(oldHash, "hex"),
        }),
      ),
    };
    const revision = getMetadataRevisionDecoder().decode(
      f.accounts.currentRevisionAccount.data,
    );
    const data = new Uint8Array(321);
    data.set(
      getMetadataRevisionEncoder().encode({
        ...revision,
        documentHash: Buffer.from(oldHash, "hex"),
      }),
    );
    f.accounts.currentRevisionAccount = { ...f.accounts.currentRevisionAccount, data };
  }
  const status = vi.fn(async () => ({
    finalized: false,
    unresolved: false,
    receipt: null,
  }));
  const save = vi.fn<MetadataAdministrationStore["save"]>(
    async (_expected, _wallet, build) => {
      const next = await build();
      f.snapshot.metadata = {
        ...f.snapshot.metadata!,
        ...next,
        id: randomUUID(),
        version: f.snapshot.metadata!.version + 1,
        status: "PREPARED",
      };
      f.snapshot.artwork.updatedAt = new Date(
        f.snapshot.artwork.updatedAt.getTime() + 1,
      );
      return true;
    },
  );
  const store: MetadataAdministrationStore = {
    current: vi.fn(async () => current),
    save,
  };
  const storage: StorageProvider = {
    read: vi.fn(async (ref) => {
      const bytes = docs.get(ref.contentHash);
      if (!bytes) throw new Error("Missing synthetic bytes");
      return bytes;
    }),
    put: vi.fn(async ({ bytes, visibility, mimeType }) => {
      const hash = await sha256Hex(bytes);
      docs.set(hash, bytes);
      return {
        storageKey: `public/${hash}.json`,
        contentHash: hash,
        visibility,
        mimeType,
        byteSize: String(bytes.length),
      };
    }),
  };
  const revisions: MetadataRevisionStore = {
    load: f.load,
    operations: () => ({ save: f.save }),
  };
  const admin = createMetadataAdministration(
    revisions,
    store,
    f.authorization,
    f.readChain,
    storage,
    "localnet",
    "http://localhost:3001",
    status,
  );
  const service = createMetadataRevisions(
    revisions,
    f.authorization,
    f.readChain,
    f.chain,
    storage,
    "localnet",
    admin,
  );
  const input = {
    expectedUpdatedAt: f.snapshot.artwork.updatedAt.toISOString(),
    metadataVersionId: f.snapshot.metadata!.id,
    publicContent: { ...original.publicContent, story: "Revised public story" },
    publicApprovalConfirmed: true,
  };
  return {
    ...f,
    admin,
    service,
    store,
    status,
    storage,
    saveDocument: save,
    input,
    current,
  };
}
it.each(["INITIALIZE", "UNMINTED", "MINTED"] as const)(
  "reviews validated %s documents and immutable identity",
  async (mode) => {
    const f = await fixture(mode),
      page = await f.admin.review("Bearer synthetic", f.snapshot.artwork.kathaId);
    expect(page.chain.mode).toBe(mode);
    expect(page.canSubmit).toBe(true);
    expect(page.canSave).toBe(true);
    expect(JSON.stringify(page)).not.toContain("PRIVATE ARTIST BIO");
    expect(page.current?.documentHash ?? null).toBe(page.chain.documentHash);
  },
);
it("requires administrator session before private review reads", async () => {
  const f = await fixture();
  await expect(
    f.admin.review(undefined, f.snapshot.artwork.kathaId),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.readChain).not.toHaveBeenCalled();
  expect(f.store.current).not.toHaveBeenCalled();
});
it("saves append-only exact public bytes while preserving all other fields", async () => {
  const f = await fixture(),
    before = metadataDocumentSchema.parse(
      JSON.parse(f.snapshot.metadata!.canonicalDocument!),
    );
  const old = structuredClone(f.current);
  const page = await f.admin.save(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.input,
  );
  const next = metadataDocumentSchema.parse(
    JSON.parse(page.metadata!.canonicalDocument),
  );
  expect(next).toEqual({ ...before, publicContent: f.input.publicContent });
  expect(f.current).toEqual(old);
  expect(page.updatedAt).not.toBe(f.input.expectedUpdatedAt);
  expect(page.metadata!.id).not.toBe(f.input.metadataVersionId);
  expect(page.metadata!.documentHash).toBe(
    await sha256Hex(canonicalDocumentBytes(next)),
  );
  expect(f.storage.put).toHaveBeenCalledWith(
    expect.objectContaining({ visibility: "PUBLIC", mimeType: "application/json" }),
  );
});
it.each([
  "stale",
  "identity",
  "unapproved",
  "unknown",
  "index-gap",
  "no-op",
  "storage",
  "save-race",
])("blocks %s without a saved revision", async (reason) => {
  const f = await fixture();
  let input: unknown = f.input;
  if (reason === "stale") f.input.expectedUpdatedAt = "2026-10-01T00:00:00.000Z";
  if (reason === "identity") input = { ...f.input, artistId: randomUUID() };
  if (reason === "unapproved") input = { ...f.input, publicApprovalConfirmed: false };
  if (reason === "unknown")
    f.status.mockResolvedValue({ finalized: false, unresolved: true, receipt: null });
  if (reason === "index-gap") f.current!.chainVersion = 2;
  if (reason === "no-op")
    f.input.publicContent = metadataDocumentSchema.parse(
      JSON.parse(f.snapshot.metadata!.canonicalDocument!),
    ).publicContent;
  if (reason === "storage")
    vi.mocked(f.storage.read).mockImplementation(async (ref) =>
      ref.contentHash === f.snapshot.metadata!.documentHash ||
      ref.contentHash === f.current!.documentHash
        ? new TextEncoder().encode(
            ref.contentHash === f.current!.documentHash
              ? f.current!.canonicalDocument!
              : f.snapshot.metadata!.canonicalDocument!,
          )
        : new Uint8Array([1]),
    );
  if (reason === "save-race") f.saveDocument.mockResolvedValue(false);
  await expect(
    f.admin.save("Bearer synthetic", f.snapshot.artwork.kathaId, input),
  ).rejects.toMatchObject({
    code:
      reason === "identity" || reason === "unapproved" ? "INVALID_REQUEST" : "CONFLICT",
  });
  if (!["storage", "save-race"].includes(reason))
    expect(f.saveDocument).not.toHaveBeenCalled();
});
it.each(["head-address", "revision-hash", "core-uri", "core-owner-program"])(
  "rejects forged %s at review",
  async (reason) => {
    const f = await fixture();
    if (f.accounts.mode !== "MINTED") throw new Error("Fixture mode");
    if (reason === "head-address")
      f.accounts.metadataHeadAccount = {
        ...f.accounts.metadataHeadAccount,
        address: f.accounts.assetAccount.address,
      };
    if (reason === "revision-hash") {
      const data = Uint8Array.from(f.accounts.currentRevisionAccount.data);
      data[80] = data[80]! ^ 1;
      f.accounts.currentRevisionAccount = {
        ...f.accounts.currentRevisionAccount,
        data,
      };
    }
    if (reason === "core-uri") {
      const data = Uint8Array.from(f.accounts.assetAccount.data);
      data[data.length - 2] = data[data.length - 2]! ^ 1;
      f.accounts.assetAccount = { ...f.accounts.assetAccount, data };
    }
    if (reason === "core-owner-program")
      f.accounts.assetAccount = {
        ...f.accounts.assetAccount,
        programAddress: f.accounts.artworkAccount.programAddress,
      };
    await expect(
      f.admin.review("Bearer synthetic", f.snapshot.artwork.kathaId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);

it("private review/save routes reject unknown fields and redact RPC failures", async () => {
  const f = await fixture(),
    app = createApi(
      undefined,
      undefined,
      [],
      undefined,
      f.authorization,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      f.service,
    );
  const path = `/admin/artworks/${f.snapshot.artwork.kathaId}/metadata`;
  const review = await app.request(path, {
    headers: { Authorization: "Bearer synthetic" },
  });
  expect(review.status).toBe(200);
  expect(review.headers.get("Cache-Control")).toBe("no-store");
  expect((await app.request(path)).status).toBe(401);
  expect(
    (
      await app.request(path + "?private=true", {
        headers: { Authorization: "Bearer synthetic" },
      })
    ).status,
  ).toBe(400);
  const bad = await app.request(path + "/documents", {
    method: "POST",
    headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" },
    body: JSON.stringify({ ...f.input, artistId: randomUUID() }),
  });
  expect(bad.status).toBe(400);
  f.readChain.mockRejectedValueOnce(new Error("PRIVATE RPC SENTINEL"));
  const failed = await app.request(path, {
    headers: { Authorization: "Bearer synthetic" },
  });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("PRIVATE RPC SENTINEL");
});
