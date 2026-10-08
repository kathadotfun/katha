import { expect, it, vi } from "vitest";
import type { PublicProvenanceStore } from "@katha/db";
import {
  canonicalDocumentBytes,
  sha256Hex,
  artworkProvenanceResponseSchema,
} from "@katha/shared";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  findArtworkPda,
  findAssetPda,
  findReportPda,
  findReviseMintedMetadataRevisionPda,
  findTransitionCustodyTransitionPda,
} from "@katha/solana/registry";
import { createArtworkProvenance } from "../src/artwork-provenance.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";

import {
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  findListingPda,
} from "@katha/solana/marketplace";

const at = new Date("2026-10-05T00:00:00.000Z");
const wallet = "11111111111111111111111111111111";
const id = "aaaaaaaa-1111-4111-8111-111111111111";
const kathaId = "KATHA-PAUBHA-000001";
const query = { limit: 20, offset: 0 };
type Snapshot = NonNullable<Awaited<ReturnType<PublicProvenanceStore["find"]>>>;
async function fixture() {
  const [artwork] = await findArtworkPda({ kathaId });
  const [asset] = await findAssetPda({ artwork });
  const [revision] = await findReviseMintedMetadataRevisionPda({
    artwork,
    nextVersion: 1,
  });
  const [report] = await findReportPda({ reportId: Buffer.alloc(16, 1) });
  const [transition] = await findTransitionCustodyTransitionPda({
    artwork,
    nextRevision: 1n,
  });
  const payloads = [
    {
      name: "ArtworkRegistered",
      artwork,
      kathaId,
      artistId: id,
      creatorWallet: null,
      authorshipEvidenceHash: "a".repeat(64),
      creationYear: 2026,
      category: "PAUBHA",
      collection: wallet,
      registeredBy: wallet,
      registeredAt: "1791158400",
    },
    {
      name: "ArtworkVerified",
      artwork,
      kathaId,
      authorshipEvidenceHash: "a".repeat(64),
      verifier: wallet,
      verifiedAt: "1791158400",
    },
    {
      name: "MetadataCommitted",
      artwork,
      kathaId,
      revision,
      version: 1,
      documentHash: "b".repeat(64),
      committedBy: wallet,
      committedAt: "1791158400",
    },
    {
      name: "ConditionRecorded",
      artwork,
      kathaId,
      report,
      reportId: "01".repeat(16),
      version: 1,
      reportHash: "c".repeat(64),
      grade: 0,
      reason: 0,
      verifier: wallet,
      inspectedAt: "1791158400",
      recordedAt: "1791158400",
    },
    {
      name: "CustodyUpdated",
      artwork,
      kathaId,
      transition,
      revision: "1",
      action: 0,
      fromState: 0,
      toState: 1,
      attestedBy: wallet,
      recordedAt: "1791158400",
    },
    {
      name: "ArtworkMinted",
      artwork,
      kathaId,
      asset,
      collection: wallet,
      initialOwner: wallet,
      ownerWallet: wallet,
      metadataVersion: 1,
      metadataHash: "b".repeat(64),
      mintedBy: wallet,
      mintedAt: "1791158400",
    },
    {
      name: "CoreTransfer",
      asset,
      collection: wallet,
      newOwner: wallet,
      ownerWallet: wallet,
      authority: wallet,
    },
  ];
  const events: Snapshot["events"] = payloads.map((p, i) => ({
    id: `aaaaaaaa-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    cluster: "LOCALNET",
    programAddress: i === 6 ? CORE_PROGRAM_ADDRESS : KATHA_REGISTRY_PROGRAM_ADDRESS,
    signature: "3".repeat(88),
    slot: 9007199254740993n,
    transactionIndex: i,
    outerInstructionIndex: 0,
    innerInstructionIndex: -1,
    eventIndex: 0,
    kind: i >= 5 ? "OWNERSHIP" : "REGISTRY",
    artworkId: id,
    assetAddress: i >= 5 ? asset : null,
    payload: {
      ...p,
      notes: "PRIVATE",
      mediaHashes: ["PRIVATE"],
      inspectorId: "PRIVATE",
      shippingAddress: "PRIVATE",
    },
    chainRecordedAt: at,
    indexedAt: at,
  }));
  const record: Snapshot = {
    id,
    kathaId,
    category: "PAUBHA",
    creationYear: 2026,
    creatorWallet: null,
    authorshipEvidenceHash: "a".repeat(64),
    artist: { id, slug: "synthetic-artist", displayName: "Synthetic artist" },
    cluster: "LOCALNET",
    programs: { registry: KATHA_REGISTRY_PROGRAM_ADDRESS, core: CORE_PROGRAM_ADDRESS },
    events,
    sales: [],
    reports: [],
    inspectionMedia: [],
    registration: events[0]!,
    mint: events[5]!,
    network: {
      cluster: "LOCALNET",
      registryProgram: KATHA_REGISTRY_PROGRAM_ADDRESS,
      collection: wallet,
      genesisHash: wallet,
      finalizedSlot: 9007199254740993n,
      blocked: false,
      updatedAt: at,
    },
    checkpoints: [KATHA_REGISTRY_PROGRAM_ADDRESS, CORE_PROGRAM_ADDRESS].map(
      (programAddress) => ({
        cluster: "LOCALNET",
        programAddress,
        fromSlot: 0n,
        scannedThroughSlot: 9007199254740993n,
        lastSignature: "3".repeat(88),
        lastSignatureSlot: 9007199254740993n,
        gapFromSlot: null,
        gapThroughSlot: null,
        gapReason: null,
        updatedAt: at,
      }),
    ),
    owner: {
      cluster: "LOCALNET",
      artworkId: id,
      assetAddress: asset,
      sourceEventId: events[6]!.id,
      ownerWallet: wallet,
    },
    reconciliation: {
      cluster: "LOCALNET",
      artworkId: id,
      sourceEventId: events[6]!.id,
      indexedOwner: wallet,
      observedOwner: wallet,
      observedSlot: 9007199254740993n,
      status: "MATCH",
      checkedAt: at,
    },
    evaluatedAt: at,
  };
  const store: PublicProvenanceStore = { find: vi.fn(async () => record) };
  const boundary = createArtworkProvenance(store);
  const logs: string[] = [];
  const app = createApi(
    createLogger((s) => logs.push(s)),
    undefined,
    [],
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
    undefined,
    undefined,
    undefined,
    undefined,
    boundary,
  );
  return { record, store, boundary, app, logs };
}
it("exposes ordered public claims, exact slots, immutable attribution and bound addresses anonymously", async () => {
  const { app, store } = await fixture();
  const response = await app.request(`/artworks/${kathaId}/provenance`);
  expect(response.status).toBe(200);
  const body = artworkProvenanceResponseSchema.parse(await response.json());
  expect(body.items.map((e) => e.type)).toEqual([
    "REGISTRATION",
    "VERIFICATION",
    "METADATA",
    "CONDITION",
    "CUSTODY",
    "MINT",
    "TRANSFER",
  ]);
  expect(body.items[0]!.transaction.slot).toBe("9007199254740993");
  expect(body.attribution.creatorWallet).toBeNull();
  expect(body.indexing.status).toBe("AT_OBSERVED_HEAD");
  expect(body.chain.registryRecordAddress).not.toBeNull();
  expect(body.chain.coreAssetAddress).not.toBeNull();
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
  expect(store.find).toHaveBeenCalledWith(kathaId, query);
});
it("supports bounded condition-only history without publishing report bytes or private details", async () => {
  const { app, store, record } = await fixture();
  record.events = [record.events[3]!];
  const response = await app.request(
    `/artworks/${kathaId}/provenance?type=CONDITION&limit=1&offset=2`,
  );
  const body = artworkProvenanceResponseSchema.parse(await response.json());
  expect(body.items[0]).toMatchObject({
    type: "CONDITION",
    data: { grade: "EXCELLENT", reason: "INITIAL_VERIFICATION" },
  });
  expect(store.find).toHaveBeenCalledWith(kathaId, {
    type: "CONDITION",
    limit: 1,
    offset: 2,
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
});
it("uses the extra row only to signal hasMore", async () => {
  const { boundary } = await fixture();
  const body = await boundary.history(kathaId, { limit: 1, offset: 0 });
  expect(body.items).toHaveLength(1);
  expect(body.pagination.hasMore).toBe(true);
});
it.each([
  "limit=0",
  "limit=101",
  "limit=01",
  "offset=-1",
  "offset=100001",
  "type=SALE",
  "type=condition",
  "includePrivate=true",
  "cluster=DEVNET",
  "type=CONDITION&type=MINT",
])("rejects query %s before storage", async (q) => {
  const { app, store } = await fixture();
  expect((await app.request(`/artworks/${kathaId}/provenance?${q}`)).status).toBe(400);
  expect(store.find).not.toHaveBeenCalled();
});
it("rejects malformed IDs before storage", async () => {
  const { app, store } = await fixture();
  expect((await app.request("/artworks/KATHA-PAUBHA-000000/provenance")).status).toBe(
    400,
  );
  expect(store.find).not.toHaveBeenCalled();
});
it("returns404 for missing or unpublished artwork", async () => {
  const { app, store } = await fixture();
  vi.mocked(store.find).mockResolvedValue(null);
  expect((await app.request(`/artworks/${kathaId}/provenance`)).status).toBe(404);
});
it.each([
  "gap",
  "blocked",
  "mismatch",
  "missing",
  "invalid",
  "lag",
  "stale",
  "stale-source",
  "unbound",
  "missing-stream",
  "ahead",
  "old-owner-check",
  "missing-owner-check",
  "late-start",
])("reports indexing uncertainty: %s", async (variant) => {
  const { boundary, record } = await fixture();
  let status = "GAP_DETECTED";
  if (variant === "gap") {
    record.checkpoints[0]!.gapFromSlot = 0n;
    record.checkpoints[0]!.gapThroughSlot = 1n;
    record.checkpoints[0]!.gapReason = "HISTORY_UNAVAILABLE";
  }
  if (variant === "blocked") record.network!.blocked = true;
  if (variant === "mismatch") {
    record.reconciliation!.status = "MISMATCH";
    record.reconciliation!.observedOwner = CORE_PROGRAM_ADDRESS;
  }
  if (variant === "missing" || variant === "invalid") {
    record.reconciliation!.status = variant === "missing" ? "MISSING" : "INVALID";
    record.reconciliation!.observedOwner = null;
  }
  if (variant === "lag") {
    record.checkpoints[1]!.scannedThroughSlot = 9007199254740992n;
    status = "LAGGING";
  }
  if (variant === "stale") {
    record.evaluatedAt = new Date(at.getTime() + 30001);
    status = "STALE";
  }
  if (variant === "stale-source") {
    record.reconciliation!.sourceEventId = id;
    status = "STALE";
  }
  if (variant === "unbound") {
    record.network = null;
    status = "UNKNOWN";
  }
  if (variant === "missing-stream") {
    record.checkpoints.pop();
    status = "UNKNOWN";
  }
  if (variant === "ahead") {
    record.checkpoints[0]!.scannedThroughSlot = 9007199254740994n;
    status = "UNKNOWN";
  }
  if (variant === "old-owner-check") {
    record.network!.finalizedSlot++;
    for (const c of record.checkpoints)
      c.scannedThroughSlot = record.network!.finalizedSlot;
    status = "STALE";
  }
  if (variant === "missing-owner-check") {
    record.reconciliation = null;
    status = "UNKNOWN";
  }
  if (variant === "late-start") {
    record.registration!.slot = 1n;
    record.checkpoints[0]!.fromSlot = 2n;
    status = "UNKNOWN";
  }
  const body = await boundary.history(kathaId, query);
  expect(body.indexing.status).toBe(status);
  expect(body.items).toHaveLength(7);
});
it("returns an empty unknown timeline for eligible records awaiting indexing", async () => {
  const { boundary, record } = await fixture();
  record.events = [];
  record.registration = null;
  record.mint = null;
  record.network = null;
  record.reconciliation = null;
  const body = await boundary.history(kathaId, query);
  expect(body.chain).toMatchObject({
    registryRecordAddress: null,
    coreAssetAddress: null,
  });
  expect(body.indexing.status).toBe("UNKNOWN");
});
it.each([
  "program",
  "cluster",
  "artwork",
  "category",
  "artist",
  "creator",
  "evidence",
  "collection",
  "report",
  "grade",
  "time",
  "revision",
  "custody",
  "mint",
  "transfer",
  "unknown",
  "negative-slot",
  "bad-signature",
  "inspection-order",
])("fails closed for malformed stored evidence: %s", async (variant) => {
  const { app, record, logs } = await fixture();
  if (variant === "program") record.events[1]!.programAddress = wallet;
  if (variant === "cluster") record.events[1]!.cluster = "DEVNET";
  if (variant === "artwork") record.events[1]!.payload.artwork = wallet;
  if (variant === "category") record.registration!.payload.category = "MANDALA";
  if (variant === "artist") record.registration!.payload.artistId = "PRIVATE";
  if (variant === "creator") record.registration!.payload.creatorWallet = wallet;
  if (variant === "evidence")
    record.events[1]!.payload.authorshipEvidenceHash = "d".repeat(64);
  if (variant === "collection") record.network!.collection = CORE_PROGRAM_ADDRESS;
  if (variant === "report") record.events[3]!.payload.report = wallet;
  if (variant === "grade") record.events[3]!.payload.grade = 9;
  if (variant === "time") record.events[3]!.payload.inspectedAt = "9999999999999999";
  if (variant === "revision") record.events[2]!.payload.revision = wallet;
  if (variant === "custody") record.events[4]!.payload.toState = 3;
  if (variant === "mint") record.mint!.payload.asset = wallet;
  if (variant === "transfer")
    record.events[6]!.payload.collection = CORE_PROGRAM_ADDRESS;
  if (variant === "unknown") record.events[1]!.payload.name = "PrivateUnrecognized";
  if (variant === "negative-slot") record.events[1]!.slot = -1n;
  if (variant === "bad-signature") record.events[1]!.signature = "PRIVATE";
  if (variant === "inspection-order")
    record.events[3]!.payload.inspectedAt = "1791158401";
  const response = await app.request(`/artworks/${kathaId}/provenance`);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(logs.join("")).not.toContain("PRIVATE");
});
it("redacts database failures", async () => {
  const { app, store, logs } = await fixture();
  vi.mocked(store.find).mockRejectedValue(new Error("PRIVATE SQL"));
  const response = await app.request(`/artworks/${kathaId}/provenance`);
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(logs.join("")).not.toContain("PRIVATE");
});

async function withSale(isPrimary = true) {
  const f = await fixture();
  const transfer = f.record.events[6]!;
  const [listingAddress] = await findListingPda({
    asset: (await findAssetPda({ artwork: (await findArtworkPda({ kathaId }))[0] }))[0],
  });
  transfer.payload.authority = listingAddress;
  f.record.programs.marketplace = KATHA_MARKETPLACE_PROGRAM_ADDRESS;
  const sale = {
    id,
    cluster: "LOCALNET" as const,
    artworkId: id,
    assetAddress: transfer.assetAddress!,
    sourceEventId: "dddddddd-1111-4111-8111-111111111111",
    listingId: id,
    buyerWallet: wallet,
    sellerWallet: wallet,
    paymentMint: wallet,
    price: 1000000n,
    isPrimary,
    proceedsWallet: wallet,
    proceedsAmount: isPrimary ? 975000n : 925000n,
    artistWallet: wallet,
    royaltyAmount: isPrimary ? 0n : 50000n,
    treasuryWallet: wallet,
    platformFee: 25000n,
  };
  const event = {
    ...transfer,
    id: sale.sourceEventId,
    programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    kind: "SALE" as const,
    payload: {
      name: "ArtworkPurchased",
      listingAddress,
      revision: "1",
      buyerWallet: wallet,
      isPrimary,
      proceedsWallet: wallet,
      proceedsAmount: sale.proceedsAmount.toString(),
      artistWallet: wallet,
      royaltyAmount: sale.royaltyAmount.toString(),
      treasuryWallet: wallet,
      platformFee: "25000",
      privateNotes: "PRIVATE",
    },
  };
  const listing = {
    id,
    cluster: "LOCALNET" as const,
    artworkId: id,
    assetAddress: transfer.assetAddress!,
    sourceEventId: event.id,
    listingAddress,
    listingRevision: 1n,
    sellerWallet: wallet,
    paymentMint: wallet,
    price: 1000000n,
    status: "PURCHASED" as const,
    expiresAt: at,
  };
  f.record.sales = [{ sale, event, listing }];
  return f;
}
it.each([true, false])(
  "attaches primary=%s settlement to its single Core transfer without duplicate provenance",
  async (primary) => {
    const f = await withSale(primary);
    const body = await f.boundary.history(kathaId, query);
    expect(body.items).toHaveLength(7);
    expect(body.items[6]).toMatchObject({
      type: "TRANSFER",
      data: {
        sale: {
          isPrimary: primary,
          price: "1000000",
          royaltyAmount: primary ? "0" : "50000",
        },
      },
    });
    expect(body.attribution.artist.id).toBe(id);
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
  },
);
it.each(["buyer", "authority", "revision", "amount", "source", "duplicate"])(
  "fails closed for mismatched settlement %s",
  async (fault) => {
    const f = await withSale();
    const row = f.record.sales[0]!;
    if (fault === "buyer")
      row.sale.buyerWallet = "Vote111111111111111111111111111111111111111";
    if (fault === "authority")
      row.listing.listingAddress = "Vote111111111111111111111111111111111111111";
    if (fault === "revision") row.event.payload.revision = "2";
    if (fault === "amount") row.sale.platformFee = 3n;
    if (fault === "source") row.event.programAddress = CORE_PROGRAM_ADDRESS;
    if (fault === "duplicate") f.record.sales.push(row);
    await expect(f.boundary.history(kathaId, query)).rejects.toThrow();
  },
);
it("a direct Core transfer with no settlement remains a transfer", async () => {
  const f = await fixture();
  const body = await f.boundary.history(kathaId, query);
  expect(body.items[6]).toMatchObject({ type: "TRANSFER", data: { sale: null } });
});
async function withInspection() {
  const f = await fixture();
  const event = f.record.events[3]!;
  const publicHash = "d".repeat(64),
    privateHash = "e".repeat(64);
  const doc = {
    reportId: "01010101-0101-4101-8101-010101010101",
    kathaId,
    grade: "EXCELLENT",
    reason: "INITIAL_VERIFICATION",
    inspectorId: id,
    verifierWallet: wallet,
    inspectedAt: at.toISOString(),
    reportedAt: at.toISOString(),
    notes: "PRIVATE",
    mediaHashes: [publicHash, privateHash],
  };
  event.payload.reportId = doc.reportId.replaceAll("-", "");
  event.payload.report = (
    await findReportPda({
      reportId: Buffer.from(String(event.payload.reportId), "hex"),
    })
  )[0];
  const canonicalDocument = new TextDecoder().decode(canonicalDocumentBytes(doc));
  const documentHash = await sha256Hex(new TextEncoder().encode(canonicalDocument));
  event.payload.reportHash = documentHash;
  f.record.reports = [
    {
      id: doc.reportId,
      artworkId: id,
      status: "FINALIZED",
      authorityWallet: wallet,
      canonicalDocument,
      documentHash,
      chainCluster: "LOCALNET",
      chainSignature: event.signature,
      chainSlot: event.slot,
      chainRecordedAt: at,
      finalizedAt: at,
      createdAt: at,
      updatedAt: at,
      version: 1,
      chainVersion: 1,
      inspectorId: id,
      grade: "EXCELLENT",
      reason: "INITIAL_VERIFICATION",
      inspectedAt: at,
      reportedAt: at,
      notes: "PRIVATE",
      mediaHashes: doc.mediaHashes,
      ownerWallet: null,
      custodyRevision: null,
    },
  ];
  f.record.inspectionMedia = [
    {
      contentHash: publicHash,
      mimeType: "image/png",
      altText: "Approved synthetic inspection photograph",
    },
    { contentHash: "f".repeat(64), mimeType: "image/png", altText: "Unrelated photo" },
  ];
  return { ...f, publicHash, privateHash };
}
it("publishes only currently approved media matched to the exact historical commitment", async () => {
  const f = await withInspection();
  const body = await f.boundary.history(kathaId, query);
  expect(body.items[3]).toMatchObject({
    type: "CONDITION",
    data: { publicMedia: [{ contentHash: f.publicHash }] },
  });
  expect(JSON.stringify(body)).not.toContain(f.privateHash);
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
  f.record.inspectionMedia = [];
  const withdrawn = await f.boundary.history(kathaId, query);
  expect(withdrawn.items[3]).toMatchObject({ data: { publicMedia: [] } });
});
it.each(["hash", "scope", "receipt", "media", "version"])(
  "rejects mismatched historical inspection %s",
  async (fault) => {
    const f = await withInspection();
    const r = f.record.reports[0]!;
    if (fault === "hash") r.canonicalDocument += " ";
    if (fault === "scope") r.artworkId = "bbbbbbbb-1111-4111-8111-111111111111";
    if (fault === "receipt") r.chainSignature = "4".repeat(88);
    if (fault === "media") r.mediaHashes = ["f".repeat(64)];
    if (fault === "version") r.chainVersion = 2;
    if (fault === "version") {
      expect((await f.boundary.history(kathaId, query)).items[3]).toMatchObject({
        data: { publicMedia: [] },
      });
      return;
    }
    await expect(f.boundary.history(kathaId, query)).rejects.toThrow();
  },
);
