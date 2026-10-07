import { expect, it, vi } from "vitest";
import type { PublicArtworkDetailStore } from "@katha/db";
import { publicArtworkDetailSchema } from "@katha/shared";
import { createArtworkDetails } from "../src/artwork-details.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";

const at = new Date("2026-10-05T00:00:00.000Z");
const wallet = "11111111111111111111111111111111";
const receipt = {
  chainSignature: "3".repeat(88),
  chainSlot: 9007199254740993n,
  chainRecordedAt: at,
};
const record = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA" as const,
  title: "Synthetic artwork",
  creationYear: 2026,
  creatorWallet: wallet,
  artist: {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    slug: "synthetic-artist",
    displayName: "Synthetic artist",
    payoutWallet: "PRIVATE",
  },
  heightMm: 720,
  widthMm: 510,
  depthMm: null,
  originCountryCode: "NP",
  originRegion: "Bagmati",
  originLocality: "Patan",
  technique: "Traditional painting",
  story: "Public story",
  meaning: "Public meaning",
  culturalContext: "Public context",
  creationProcess: "Public process",
  materials: [{ name: "Canvas" }, { name: "Mineral pigments" }],
  media: [
    {
      id: "bbbbbbbb-1111-4111-8111-111111111111",
      kind: "IMAGE" as const,
      role: "HERO" as const,
      position: 0,
      contentHash: "a".repeat(64),
      mimeType: "image/png",
      altText: "Public artwork",
      storageKey: "PRIVATE",
    },
  ],
  verification: {
    ...receipt,
    authorityWallet: wallet,
    inspectedAt: at,
    documentHash: "a".repeat(64),
    canonicalDocument: "PRIVATE",
    notes: "PRIVATE",
  },
  metadata: {
    ...receipt,
    version: 2,
    uri: "https://example.com/metadata.json",
    documentHash: "a".repeat(64),
    canonicalDocument: "PRIVATE",
  },
  condition: {
    ...receipt,
    version: 3,
    grade: "GOOD" as const,
    reason: "PRE_RESALE" as const,
    inspectedAt: at,
    authorityWallet: wallet,
    documentHash: "a".repeat(64),
    notes: "PRIVATE",
    mediaHashes: ["PRIVATE"],
  },
  custody: {
    state: "KATHA_HELD" as const,
    occurredAt: at,
    evidenceHash: "PRIVATE",
    custodianWallet: "PRIVATE",
  },
  ownership: {
    ownerWallet: "Vote111111111111111111111111111111111111111",
    assetAddress: wallet,
    signature: receipt.chainSignature,
    slot: receipt.chainSlot,
    programAddress: wallet,
    chainRecordedAt: at,
    indexedAt: at,
    payload: { private: "PRIVATE" },
  },
  checkpoint: null,
  cluster: "LOCALNET" as const,
  creationRequestId: "PRIVATE",
  authorshipEvidenceHash: "PRIVATE",
};
function fixture() {
  const store: PublicArtworkDetailStore = { findByKathaId: vi.fn(async () => record) };
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createArtworkDetails(store),
  );
  return { app, store, logs };
}
it("returns anonymous structured details with exact slots and explicit field projections", async () => {
  const { app, store } = fixture();
  const response = await app.request(`/artworks/${record.kathaId}`);
  expect(response.status).toBe(200);
  const body = publicArtworkDetailSchema.parse(await response.json());
  expect(store.findByKathaId).toHaveBeenCalledWith(record.kathaId);
  expect(body.story).toBe(record.story);
  expect(body.materials).toEqual(["Canvas", "Mineral pigments"]);
  expect(body.ownership.transaction.slot).toBe("9007199254740993");
  expect(body.verification.transaction.slot).toBe("9007199254740993");
  expect(body.custody.source).toBe("MANUAL_OBSERVATION");
  expect(body.creatorWallet).toBe(wallet);
  expect(body.ownership.ownerWallet).not.toBe(body.creatorWallet);
  expect(body.indexing).toEqual({ freshness: "UNKNOWN", checkpoint: null });
  expect(body.chain.registryRecordAddress).toBeNull();
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
});
it("represents missing documentation and custody without claiming possession", async () => {
  const { app, store } = fixture();
  vi.mocked(store.findByKathaId).mockResolvedValue({
    ...record,
    creatorWallet: null,
    heightMm: null,
    widthMm: null,
    originRegion: null,
    originLocality: null,
    story: null,
    meaning: null,
    culturalContext: null,
    creationProcess: null,
    technique: null,
    materials: [],
    media: [],
    custody: null,
  });
  const body = publicArtworkDetailSchema.parse(
    await (await app.request(`/artworks/${record.kathaId}`)).json(),
  );
  expect(body.creatorWallet).toBeNull();
  expect(body.dimensions).toBeNull();
  expect(body.custody).toEqual({
    state: "UNKNOWN",
    source: "UNKNOWN",
    observedAt: null,
  });
});
it.each([true, false])(
  "exposes source checkpoint gaps without asserting complete freshness: gap %s",
  async (gap) => {
    const { app, store } = fixture();
    vi.mocked(store.findByKathaId).mockResolvedValue({
      ...record,
      checkpoint: {
        programAddress: wallet,
        scannedThroughSlot: 9007199254740993n,
        gapFromSlot: gap ? 5n : null,
        gapThroughSlot: gap ? 8n : null,
        updatedAt: at,
      },
    });
    const body = publicArtworkDetailSchema.parse(
      await (await app.request(`/artworks/${record.kathaId}`)).json(),
    );
    expect(body.indexing.freshness).toBe(gap ? "GAP_DETECTED" : "UNKNOWN");
    expect(body.indexing.checkpoint?.scannedThroughSlot).toBe("9007199254740993");
  },
);
it("returns404 for absent or ineligible records", async () => {
  const { app, store } = fixture();
  vi.mocked(store.findByKathaId).mockResolvedValue(null);
  expect((await app.request(`/artworks/${record.kathaId}`)).status).toBe(404);
});
it.each(["invalid", "KATHA-PAUBHA-000000", "katha-paubha-000001", "KATHA-NFT-000001"])(
  "rejects malformed ID %s before storage",
  async (id) => {
    const { app, store } = fixture();
    expect((await app.request(`/artworks/${id}`)).status).toBe(400);
    expect(store.findByKathaId).not.toHaveBeenCalled();
  },
);
it.each(["cluster=DEVNET", "includePrivate=true", "limit=1", "foo=1&foo=2"])(
  "rejects detail query %s before storage",
  async (query) => {
    const { app, store } = fixture();
    expect((await app.request(`/artworks/${record.kathaId}?${query}`)).status).toBe(
      400,
    );
    expect(store.findByKathaId).not.toHaveBeenCalled();
  },
);
it("redacts storage errors", async () => {
  const { app, store, logs } = fixture();
  vi.mocked(store.findByKathaId).mockRejectedValue(new Error("PRIVATE-DATABASE"));
  const response = await app.request(`/artworks/${record.kathaId}`);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(logs.join("")).not.toContain("PRIVATE");
});
it("fails closed for malformed finalized receipts", async () => {
  const { app, store } = fixture();
  vi.mocked(store.findByKathaId).mockResolvedValue({
    ...record,
    verification: { ...record.verification, chainSignature: null },
  });
  expect((await app.request(`/artworks/${record.kathaId}`)).status).toBe(500);
});

it("projects the finalized document story while preserving identity and excluding canonical bytes", async () => {
  const { registrationFixture } = await import("./fixtures/registration.js");
  const { metadataDocumentSchema, canonicalDocumentBytes, sha256Hex } =
    await import("@katha/shared");
  const f = await registrationFixture();
  const doc = metadataDocumentSchema.parse({
    ...JSON.parse(f.snapshot.metadata!.canonicalDocument!),
    kathaId: record.kathaId,
    name: record.title,
    artist: {
      artistId: record.artist.id,
      creatorWallet: record.creatorWallet,
      displayName: record.artist.displayName,
    },
    publicContent: {
      story: "Finalized revised story",
      meaning: "Revised meaning",
      culturalContext: "Nepali culture",
      creationProcess: "Revised process",
    },
  });
  const bytes = canonicalDocumentBytes(doc);
  const saved = {
    ...record,
    currentMetadataDocument: new TextDecoder().decode(bytes),
    metadata: { ...record.metadata, documentHash: await sha256Hex(bytes) },
  };
  const store: PublicArtworkDetailStore = { findByKathaId: vi.fn(async () => saved) };
  const result = await createArtworkDetails(store).detail(record.kathaId);
  expect(result.story).toBe(doc.publicContent.story);
  expect(result.artist.id).toBe(record.artist.id);
  expect(result.creatorWallet).toBe(record.creatorWallet);
  expect(JSON.stringify(result)).not.toContain("currentMetadataDocument");
  doc.artist.artistId = "bbbbbbbb-1111-4111-8111-111111111111";
  saved.currentMetadataDocument = new TextDecoder().decode(canonicalDocumentBytes(doc));
  await expect(
    createArtworkDetails(store).detail(record.kathaId),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
