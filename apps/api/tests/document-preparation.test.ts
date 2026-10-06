import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalDocumentBytes,
  sha256Hex,
  metadataDocumentSchema,
  type WalletSession,
} from "@katha/shared";
import type { DocumentPreparationStore } from "@katha/db";
import { createLocalStorageProvider } from "../src/local-storage.js";
import { createDocumentPreparation } from "../src/document-preparation.js";
import { createPublicDocuments } from "../src/public-documents.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createAuthorization } from "../src/authorization.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
type Snapshot = Parameters<Parameters<DocumentPreparationStore["prepare"]>[4]>[0];
async function fixture(admin = false) {
  const base = await mkdtemp(join(tmpdir(), "katha-documents-"));
  temporary.push(base);
  const storage = createLocalStorageProvider({ root: join(base, ".storage") });
  const wallet = temporaryWallet().address;
  const at = new Date("2026-10-05T00:00:00.000Z");
  const session: WalletSession = {
    walletAddress: wallet,
    walletId: randomUUID(),
    cluster: "localnet",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const image = await storage.put({
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1l8AAAAASUVORK5CYII=",
      "base64",
    ),
    mimeType: "image/png",
    visibility: "PUBLIC",
  });
  const id = randomUUID();
  const artistId = randomUUID();
  const snapshot: Snapshot = {
    artwork: {
      id,
      kathaId: "KATHA-PAUBHA-000001",
      creationRequestId: null,
      artistId,
      category: "PAUBHA",
      creatorWallet: wallet,
      title: "Synthetic artwork",
      creationYear: 2026,
      authorshipEvidenceHash: "e".repeat(64),
      heightMm: 720,
      widthMm: 510,
      depthMm: null,
      originCountryCode: "NP",
      originRegion: "Bagmati",
      originLocality: null,
      technique: "Synthetic technique",
      story: "Public story",
      meaning: "Public meaning",
      culturalContext: "Public context",
      creationProcess: "Public process",
      publishedAt: null,
      createdAt: at,
      updatedAt: at,
    },
    artist: {
      id: artistId,
      slug: "synthetic-artist",
      displayName: "Synthetic Artist",
      biography: "PRIVATE BIO",
      region: "Bagmati",
      traditions: ["Paubha"],
      publicLinks: [],
      profileImageUrl: null,
      creatorWallet: wallet,
      payoutWallet: wallet,
      verificationStatus: "VERIFIED",
      verifiedAt: at,
      verifiedByWallet: wallet,
      createdAt: at,
      updatedAt: at,
    },
    materials: [{ id: randomUUID(), artworkId: id, name: "Canvas", position: 0 }],
    media: [
      {
        id: randomUUID(),
        artworkId: id,
        kind: "IMAGE",
        role: "HERO",
        visibility: "PUBLIC",
        position: 0,
        storageKey: image.storageKey,
        contentHash: image.contentHash,
        mimeType: image.mimeType,
        byteSize: BigInt(image.byteSize),
        altText: "Public image",
        caption: "PRIVATE CAPTION",
        createdAt: at,
        updatedAt: at,
      },
    ],
  };
  const built: { document?: string } = {};
  const prepare = vi.fn<DocumentPreparationStore["prepare"]>(
    async (_id, _token, authorityWallet, kind, build) => {
      const result = await build(snapshot);
      built.document = result.canonicalDocument;
      return {
        status: "prepared",
        record: {
          id: result.condition?.id ?? randomUUID(),
          artworkId: id,
          version: 1,
          chainVersion: null,
          status: "PREPARED",
          authorityWallet,
          canonicalDocument: result.canonicalDocument,
          documentHash: result.documentHash,
          uri: kind === "METADATA" ? result.uri : null,
          chainCluster: null,
          chainSignature: null,
          chainSlot: null,
          chainRecordedAt: null,
          finalizedAt: null,
          createdAt: at,
          updatedAt: at,
        },
      };
    },
  );
  const boundary = createDocumentPreparation(
    { prepare },
    storage,
    "http://localhost:3001",
  );
  const authorization = createAuthorization(
    {
      authenticate: async (header) => {
        if (header === "Bearer outsider")
          return { ...session, walletAddress: temporaryWallet().address };
        if (header !== "Bearer verifier" && !(admin && header === "Bearer admin"))
          throw new DomainError("UNAUTHENTICATED");
        return session;
      },
    },
    {
      cluster: "localnet",
      adminWallets: admin ? [wallet] : [],
      verifierWallets: admin ? [] : [wallet],
    },
    async () => ({
      authority: wallet,
      registrationAuthority: wallet,
      custodyAuthority: wallet,
      verifierAuthority: wallet,
    }),
  );
  const app = createApi(
    createLogger(() => {}),
    undefined,
    [],
    undefined,
    authorization,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    boundary,
    createPublicDocuments(
      {
        findMetadata: async (hash) => {
          if (
            !built.document ||
            (await sha256Hex(new TextEncoder().encode(built.document))) !== hash
          )
            return null;
          return { canonicalDocument: built.document, documentHash: hash };
        },
        findMedia: async () => null,
      },
      storage,
    ),
  );
  return { boundary, snapshot, session, storage, built, prepare, app, at };
}
it("persists exact public metadata bytes without private evidence or captions", async () => {
  const f = await fixture();
  const response = await f.boundary.metadata(
    f.snapshot.artwork.kathaId,
    { expectedUpdatedAt: f.at.toISOString() },
    f.session,
  );
  const document = metadataDocumentSchema.parse(JSON.parse(f.built.document!));
  expect(f.built.document).toBe(
    new TextDecoder().decode(canonicalDocumentBytes(document)),
  );
  expect(await sha256Hex(new TextEncoder().encode(f.built.document!))).toBe(
    response.documentHash,
  );
  expect(f.built.document).not.toContain("PRIVATE");
  expect(f.built.document).not.toContain("e".repeat(64));
  expect(document.media[0]?.contentHash).toBe(f.snapshot.media[0]?.contentHash);
  expect(response.uri).toContain(`/storage/public/${response.documentHash}.json`);
  const delivered = await f.app.request(
    `/storage/public/${response.documentHash}.json`,
  );
  expect(delivered.status).toBe(200);
  expect(delivered.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await delivered.text()).toBe(f.built.document);
  expect(
    (await f.app.request(`/storage/private/${response.documentHash}.json`)).status,
  ).toBe(404);

  const publicService = createPublicDocuments(
    {
      findMetadata: async () => ({
        canonicalDocument: f.built.document!,
        documentHash: response.documentHash,
      }),
      findMedia: async () => null,
    },
    f.storage,
  );
  expect(
    new TextDecoder().decode(
      (await publicService.read(`${response.documentHash}.json`)).bytes,
    ),
  ).toBe(f.built.document);
});
it("keeps canonical condition notes private and binds the session verifier", async () => {
  const f = await fixture();
  f.snapshot.media[0]!.role = "CONDITION";
  const result = await f.boundary.condition(
    f.snapshot.artwork.kathaId,
    {
      expectedUpdatedAt: f.at.toISOString(),
      reportId: randomUUID(),
      inspectorId: randomUUID(),
      grade: "GOOD",
      reason: "PRE_RESALE",
      scope: {
        ownerWallet: f.session.walletAddress,
        custodyRevision: 3,
        custodyState: "COLLECTOR_HELD",
      },
      inspectedAt: f.at.toISOString(),
      reportedAt: f.at.toISOString(),
      notes: "PRIVATE INSPECTION",
      mediaIds: [f.snapshot.media[0]!.id],
    },
    f.session,
  );
  expect(JSON.parse(f.built.document!).scope).toEqual({
    ownerWallet: f.session.walletAddress,
    custodyRevision: 3,
    custodyState: "COLLECTOR_HELD",
  });
  expect(result.uri).toBeNull();
  expect(f.built.document).toContain("PRIVATE INSPECTION");
  expect(JSON.parse(f.built.document!).verifierWallet).toBe(f.session.walletAddress);
  const service = createPublicDocuments(
    { findMetadata: async () => null, findMedia: async () => null },
    f.storage,
  );
  await expect(service.read(`${result.documentHash}.json`)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it.each(["missing-content", "private-hero", "tampered-hash"])(
  "rejects invalid metadata snapshot %s",
  async (failure) => {
    const f = await fixture();
    if (failure === "missing-content") f.snapshot.artwork.story = null;
    if (failure === "private-hero") f.snapshot.media[0]!.visibility = "PRIVATE";
    if (failure === "tampered-hash") f.snapshot.media[0]!.contentHash = "b".repeat(64);
    await expect(
      f.boundary.metadata(
        f.snapshot.artwork.kathaId,
        { expectedUpdatedAt: f.at.toISOString() },
        f.session,
      ),
    ).rejects.toBeDefined();
    expect(f.built.document).toBeUndefined();
  },
);
it.each(["metadata", "condition"] as const)(
  "requires authorization before %s preparation",
  async (kind) => {
    const f = await fixture();
    const response = await f.app.request(
      `/verifier/artworks/${f.snapshot.artwork.kathaId}/documents/${kind}`,
      { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } },
    );
    expect(response.status).toBe(401);
    expect(f.prepare).not.toHaveBeenCalled();
  },
);
it("validates payloads before persistence and returns a no-store prepared summary", async () => {
  const f = await fixture();
  const post = (body: unknown) =>
    f.app.request(
      `/verifier/artworks/${f.snapshot.artwork.kathaId}/documents/metadata`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer verifier",
        },
      },
    );
  expect(
    (await post({ expectedUpdatedAt: f.at.toISOString(), authorityWallet: "FORGED" }))
      .status,
  ).toBe(400);
  expect(f.prepare).not.toHaveBeenCalled();
  const response = await post({ expectedUpdatedAt: f.at.toISOString() });
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("does not expose arbitrary metadata JSON or private paths through delivery", async () => {
  const f = await fixture();
  const read = createPublicDocuments(
    {
      findMetadata: async () => ({
        canonicalDocument: '{"notes":"PRIVATE"}',
        documentHash: "a".repeat(64),
      }),
      findMedia: async () => null,
    },
    f.storage,
  ).read;
  await expect(read(`${"a".repeat(64)}.json`)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(read("../private/secret.json")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});

it.each(["metadata", "condition"])(
  "denies authenticated outsiders for %s preparation",
  async (kind) => {
    const f = await fixture();
    const response = await f.app.request(
      `/verifier/artworks/${f.snapshot.artwork.kathaId}/documents/${kind}`,
      {
        method: "POST",
        body: "{}",
        headers: {
          Authorization: "Bearer outsider",
          "Content-Type": "application/json",
        },
      },
    );
    expect(response.status).toBe(403);
    expect(f.prepare).not.toHaveBeenCalled();
  },
);

it("normalizes UUID identifiers before canonical condition persistence", async () => {
  const f = await fixture();
  f.snapshot.media[0]!.role = "CONDITION";
  const reportId = randomUUID();
  const inspectorId = randomUUID();
  const result = await f.boundary.condition(
    f.snapshot.artwork.kathaId,
    {
      expectedUpdatedAt: f.at.toISOString(),
      reportId: reportId.toUpperCase(),
      inspectorId: inspectorId.toUpperCase(),
      grade: "GOOD",
      reason: "PRE_SALE",
      inspectedAt: f.at.toISOString(),
      reportedAt: f.at.toISOString(),
      notes: "Synthetic notes",
      mediaIds: [f.snapshot.media[0]!.id.toUpperCase()],
    },
    f.session,
  );
  expect(result.id).toBe(reportId);
  expect(JSON.parse(f.built.document!).inspectorId).toBe(inspectorId);
});

it("permits admin canonical metadata preparation without granting condition authority", async () => {
  const path = (id: string) => `/admin/artworks/${id}/documents/metadata`;
  const verifier = await fixture();
  expect(
    (
      await verifier.app.request(path(verifier.snapshot.artwork.kathaId), {
        method: "POST",
        headers: {
          Authorization: "Bearer verifier",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
  ).toBe(403);
  expect(verifier.prepare).not.toHaveBeenCalled();
  const f = await fixture(true);
  const response = await f.app.request(path(f.snapshot.artwork.kathaId), {
    method: "POST",
    headers: { Authorization: "Bearer admin", "Content-Type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: f.at.toISOString() }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.text()).not.toContain("PRIVATE");
  expect(
    (
      await f.app.request(
        `/verifier/artworks/${f.snapshot.artwork.kathaId}/documents/condition`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer admin",
            "Content-Type": "application/json",
          },
          body: "{}",
        },
      )
    ).status,
  ).toBe(403);
});
