import { createNfcResolution } from "../src/nfc-resolution.js";
import { createNfcResolutionStore, createNfcTagStore, wallets } from "@katha/db";
import { createArtworkProvenance } from "../src/artwork-provenance.js";
import {
  createPublicProvenanceStore,
  indexerNetworks,
  ownershipReconciliations,
} from "@katha/db";
import { artworkProvenanceResponseSchema } from "@katha/shared";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "@katha/solana/marketplace";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  findArtworkPda,
  findAssetPda,
  findReportPda,
  findReviseMintedMetadataRevisionPda,
  findTransitionCustodyTransitionPda,
} from "@katha/solana/registry";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentPreparation } from "../src/document-preparation.js";
import { createLocalStorageProvider } from "../src/local-storage.js";
import { createArtworkDetails } from "../src/artwork-details.js";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  createDatabase,
  createMarketplaceListingStore,
  validateDatabaseUrl,
  createArtistStore,
  createPublicArtworkStore,
  createDocumentPreparationStore,
  createPublicArtworkDetailStore,
  artworkMaterials,
  custodyEvents,
  indexerCheckpoints,
  createArtworkDraftStore,
  artworks,
  artworkMedia,
  verifications,
  artworkMetadataVersions,
  conditionReports,
  indexedEvents,
  artworkOwnership,
} from "@katha/db";
import {
  metadataDocumentSchema,
  canonicalDocumentBytes,
  artworkDiscoveryResponseSchema,
  publicArtworkDetailSchema,
} from "@katha/shared";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createArtworkDiscovery } from "../src/artwork-discovery.js";
import { temporaryWallet } from "./fixtures/wallet.js";

type FixtureOptions = {
  category: "PAUBHA" | "MANDALA" | "THANGKA";
  cluster: "LOCALNET" | "DEVNET";
  published: boolean;
  future: boolean;
  artistApproved: boolean;
  verification: "FINALIZED" | "PREPARED" | "MISSING";
  metadata: boolean;
  inspection: boolean;
  ownership: boolean;
  hero: "PUBLIC" | "PRIVATE" | "MISSING";
  metadataVersions: number;
  conditionVersions: number;
};

it("discovers only explicitly published, finalized artworks on the configured cluster without private media or duplicate rows", async () => {
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable target");
  const parent = createDatabase(url);
  const name = `katha_discovery_${randomUUID().replaceAll("-", "")}`;
  const freshUrl = new URL(url);
  freshUrl.pathname = `/${name}`;
  const database = createDatabase(freshUrl.toString());
  const storageDirectory = await mkdtemp(join(tmpdir(), "katha-doc-pg-"));
  let created = false;
  const wallet = temporaryWallet();
  let fixtureNumber = 0;
  const logs: string[] = [];
  const store = createPublicArtworkStore(database.db, "LOCALNET");
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createArtworkDiscovery(store),
    createArtworkDetails(createPublicArtworkDetailStore(database.db, "LOCALNET")),
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
    createNfcResolution(
      createNfcResolutionStore(database.db, "LOCALNET"),
      "https://katha.fun",
    ),
  );
  const hash = (document: string) =>
    createHash("sha256").update(document).digest("hex");
  async function fixture(overrides: Partial<FixtureOptions> = {}) {
    const options: FixtureOptions = {
      category: "PAUBHA",
      cluster: "LOCALNET",
      published: true,
      future: false,
      artistApproved: true,
      verification: "FINALIZED",
      metadata: true,
      inspection: true,
      ownership: true,
      hero: "PUBLIC",
      metadataVersions: 1,
      conditionVersions: 1,
      ...overrides,
    };
    const number = ++fixtureNumber;
    const artistStore = createArtistStore(database.db);
    const artist = await artistStore.create({
      slug: `synthetic-discovery-${randomUUID()}`,
      displayName: "Synthetic public artist",
      biography: "Synthetic public biography",
      region: "Patan",
      traditions: ["Paubha"],
      creatorWallet: wallet.address,
      payoutWallet: wallet.address,
    });
    if (!artist) throw new Error("Expected fixture artist");
    if (options.artistApproved) await artistStore.verify(artist.id, wallet.address);
    const now = new Date();
    const [record] = await database.db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: options.category,
        title: `Synthetic artwork ${number}`,
        creationYear: 2026,
        story: "Public synthetic story",
        meaning: "Public synthetic meaning",
        culturalContext: "Public synthetic context",
        creationProcess: "Public synthetic process",
        heightMm: 720,
        widthMm: 510,
        technique: "Traditional synthetic painting",
        originRegion: "Bagmati",
        authorshipEvidenceHash: "e".repeat(64),
        createdAt: now,
        updatedAt: now,
        publishedAt: options.published
          ? new Date(now.getTime() + (options.future ? 60000 : 0))
          : null,
      })
      .returning();
    if (!record) throw new Error("Expected fixture artwork");
    const at = new Date();
    async function finalize(
      table: "verifications" | "artwork_metadata_versions" | "condition_reports",
      id: string,
      version?: number,
    ) {
      // Table names are fixed test constants; all fixture values are bound parameters.
      await database.db.$client.unsafe(
        `UPDATE ${table} SET status = 'FINALIZED', chain_cluster = $1, chain_signature = $2, chain_slot = 1, chain_recorded_at = $3, finalized_at = $3, updated_at = $3${version === undefined ? "" : ", chain_version = $5"} WHERE id = $4`,
        [
          options.cluster,
          "3".repeat(88),
          at.toISOString(),
          id,
          ...(version === undefined ? [] : [version]),
        ],
      );
    }
    // These synthetic finalized rows test read predicates; no blockchain transaction is sent.
    if (options.verification !== "MISSING") {
      const document = JSON.stringify({
        kathaId: record.kathaId,
        evidenceHash: "e".repeat(64),
        verifierWallet: wallet.address,
        inspectedAt: at.toISOString(),
        notes: "PRIVATE VERIFICATION NOTES",
      });
      const [verification] = await database.db
        .insert(verifications)
        .values({
          artworkId: record.id,
          authorityWallet: wallet.address,
          createdAt: at,
          updatedAt: at,
          status: "PREPARED",
          evidenceHash: "e".repeat(64),
          inspectedAt: at,
          notes: "PRIVATE VERIFICATION NOTES",
          canonicalDocument: document,
          documentHash: hash(document),
        })
        .returning();
      if (!verification) throw new Error("Expected prepared verification");
      if (options.verification === "FINALIZED")
        await finalize("verifications", verification.id);
    }
    if (options.metadata) {
      for (let version = 1; version <= options.metadataVersions; version++) {
        const mediaUri = `https://example.com/storage/public/${"a".repeat(64)}.png`;
        const document = new TextDecoder().decode(
          canonicalDocumentBytes(
            metadataDocumentSchema.parse({
              schemaVersion: 1,
              kathaId: record.kathaId,
              name: record.title,
              category: record.category,
              artist: {
                artistId: record.artistId,
                displayName: artist.displayName,
                creatorWallet: record.creatorWallet,
              },
              creationYear: record.creationYear,
              origin: {
                countryCode: "NP",
                region: record.originRegion,
                locality: null,
              },
              dimensions: { heightMm: 720, widthMm: 510, depthMm: null },
              materials: ["Canvas", "Mineral pigments"],
              technique: record.technique,
              publicContent: {
                story: version > 1 ? "Finalized revised synthetic story" : record.story,
                meaning: record.meaning,
                culturalContext: record.culturalContext,
                creationProcess: record.creationProcess,
              },
              image: mediaUri,
              media: [
                {
                  contentHash: "a".repeat(64),
                  mimeType: "image/png",
                  role: "HERO",
                  uri: mediaUri,
                },
              ],
            }),
          ),
        );

        const [metadata] = await database.db
          .insert(artworkMetadataVersions)
          .values({
            authorityWallet: wallet.address,
            createdAt: at,
            updatedAt: at,
            artworkId: record.id,
            status: "PREPARED",
            version,
            uri: `https://example.com/synthetic/${number}/${version}.json`,
            canonicalDocument: document,
            documentHash: hash(document),
          })
          .returning();
        if (!metadata) throw new Error("Expected prepared metadata");
        await finalize("artwork_metadata_versions", metadata.id, version);
      }
    }
    if (options.inspection) {
      for (let version = 1; version <= options.conditionVersions; version++) {
        const id = randomUUID();
        const inspectorId = randomUUID();
        const document = JSON.stringify({
          kathaId: record.kathaId,
          reportId: id,
          inspectorId,
          verifierWallet: wallet.address,
          grade: version === 1 ? "EXCELLENT" : "GOOD",
          reason: version === 1 ? "INITIAL_VERIFICATION" : "PRE_RESALE",
          inspectedAt: at.toISOString(),
          reportedAt: at.toISOString(),
          notes: "PRIVATE INSPECTION NOTES",
          mediaHashes: ["e".repeat(64)],
        });
        const [inspection] = await database.db
          .insert(conditionReports)
          .values({
            authorityWallet: wallet.address,
            createdAt: at,
            updatedAt: at,
            id,
            artworkId: record.id,
            status: "PREPARED",
            version,
            inspectorId,
            grade: version === 1 ? "EXCELLENT" : "GOOD",
            reason: version === 1 ? "INITIAL_VERIFICATION" : "PRE_RESALE",
            inspectedAt: at,
            reportedAt: at,
            notes: "PRIVATE INSPECTION NOTES",
            mediaHashes: ["e".repeat(64)],
            canonicalDocument: document,
            documentHash: hash(document),
          })
          .returning();
        if (!inspection) throw new Error("Expected prepared inspection");
        await finalize("condition_reports", inspection.id, version);
      }
    }
    if (options.ownership) {
      const assetAddress = temporaryWallet().address;
      const [event] = await database.db
        .insert(indexedEvents)
        .values({
          cluster: options.cluster,
          programAddress: wallet.address,
          signature: "3".repeat(88),
          slot: 1n,
          transactionIndex: number,
          outerInstructionIndex: number,
          kind: "OWNERSHIP",
          artworkId: record.id,
          assetAddress,
          payload: {
            ownerWallet: wallet.address,
            privateEvidence: "PRIVATE INDEX PAYLOAD",
          },
          chainRecordedAt: at,
          indexedAt: at,
        })
        .returning();
      if (!event) throw new Error("Expected synthetic indexed event");
      await database.db.insert(artworkOwnership).values({
        cluster: options.cluster,
        artworkId: record.id,
        assetAddress,
        ownerWallet: wallet.address,
        sourceEventId: event.id,
      });
    }
    if (options.hero !== "MISSING")
      await database.db.insert(artworkMedia).values({
        artworkId: record.id,
        kind: "IMAGE",
        role: "HERO",
        visibility: options.hero,
        position: 0,
        storageKey: `PRIVATE-STORAGE-KEY-${number}`,
        contentHash: (options.hero === "PRIVATE" ? "b" : "a").repeat(64),
        mimeType: "image/png",
        byteSize: 1n,
        altText:
          options.hero === "PUBLIC"
            ? "Approved synthetic image"
            : "PRIVATE IMAGE CONTENT",
        caption: "PRIVATE FUTURE FIELD",
      });
    return record;
  }
  try {
    // Only the generated identifier is interpolated, never configuration or user content.
    await parent.db.execute(`CREATE DATABASE "${name}"`);
    created = true;
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../../packages/db/node_modules/drizzle-kit/bin.cjs",
            import.meta.url,
          ),
        ),
        "migrate",
      ],
      {
        cwd: fileURLToPath(new URL("../../../packages/db/", import.meta.url)),
        env: { ...process.env, DATABASE_URL: freshUrl.toString() },
        stdio: "pipe",
        timeout: 30000,
      },
    );
    const mandala = await fixture({
      category: "MANDALA",
      metadataVersions: 2,
      conditionVersions: 2,
    });
    const paubha = await fixture();
    const privateHero = await fixture({ hero: "PRIVATE" });
    const thangka = await fixture({ category: "THANGKA", hero: "MISSING" });
    const hidden = await Promise.all([
      fixture({ published: false }),
      fixture({ verification: "MISSING" }),
      fixture({ verification: "PREPARED" }),
      fixture({ metadata: false }),
      fixture({ inspection: false }),
      fixture({ ownership: false }),
      fixture({ artistApproved: false }),
      fixture({ future: true }),
    ]);
    const devnet = await fixture({ cluster: "DEVNET" });
    // Resolve real tag bindings through the catalogue's exact publication boundary.
    const [tagActor] = await database.db
      .insert(wallets)
      .values({ address: wallet.address })
      .returning();
    if (!tagActor) throw new Error("Missing synthetic tag actor");
    // Listing preparations use the exact catalogue publication gate and wallet-scoped persistence.
    const listingStore = createMarketplaceListingStore(database.db, "LOCALNET");
    expect(await listingStore.load(mandala.kathaId)).toMatchObject({
      id: mandala.id,
      kathaId: mandala.kathaId,
    });
    for (const work of [...hidden, devnet])
      expect(await listingStore.load(work.kathaId)).toBeNull();
    const operation = {
      artworkId: mandala.id,
      walletId: tagActor.id,
      cluster: "LOCALNET" as const,
      kind: "CREATE_LISTING" as const,
      idempotencyKey: "synthetic-listing-guard",
      requestHash: "a".repeat(64),
      programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      expectedAccounts: [wallet.address],
      expectedHashes: [],
    };
    const preparation = {
      canonicalRequest: '{"syntheticDatabaseFixture":true}',
      messageHash: "b".repeat(64),
      transactionBase64: "AQ==",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 20n,
      simulationUnits: 5000n,
    };
    operation.requestHash = createHash("sha256")
      .update(preparation.canonicalRequest)
      .digest("hex");
    const savedListing = await listingStore.save(
      operation,
      wallet.address,
      mandala.kathaId,
      preparation,
    );
    expect(savedListing.status).toBe("saved");
    expect(
      await listingStore.save(operation, wallet.address, mandala.kathaId, preparation),
    ).toEqual(savedListing);
    expect(
      await listingStore.save(
        { ...operation, requestHash: "c".repeat(64) },
        wallet.address,
        mandala.kathaId,
        preparation,
      ),
    ).toEqual({ status: "conflict" });
    expect(
      await listingStore.save(
        { ...operation, artworkId: hidden[0]!.id, idempotencyKey: "hidden-listing" },
        wallet.address,
        hidden[0]!.kathaId,
        preparation,
      ),
    ).toEqual({ status: "conflict" });

    const purchaseOperation = {
      ...operation,
      kind: "PURCHASE_ARTWORK" as const,
      idempotencyKey: "synthetic-purchase-guard",
    };
    const savedPurchase = await listingStore.save(
      purchaseOperation,
      wallet.address,
      mandala.kathaId,
      preparation,
    );
    expect(savedPurchase.status).toBe("saved");
    expect(
      await listingStore.save(
        purchaseOperation,
        wallet.address,
        mandala.kathaId,
        preparation,
      ),
    ).toEqual(savedPurchase);
    expect(
      await listingStore.save(
        { ...purchaseOperation, requestHash: "d".repeat(64) },
        wallet.address,
        mandala.kathaId,
        preparation,
      ),
    ).toEqual({ status: "conflict" });
    expect(
      await listingStore.save(
        {
          ...purchaseOperation,
          artworkId: hidden[0]!.id,
          idempotencyKey: "hidden-purchase",
        },
        wallet.address,
        hidden[0]!.kathaId,
        preparation,
      ),
    ).toEqual({ status: "conflict" });
    const tags = createNfcTagStore(database.db);
    const nfcStore = createNfcResolutionStore(database.db, "LOCALNET");
    const nfc = createNfcResolution(nfcStore, "https://katha.fun");
    const publicTag = randomUUID();
    await tags.assign(mandala.kathaId, publicTag, tagActor.id);
    expect(await nfcStore.find(publicTag)).toEqual({
      tagId: publicTag,
      kathaId: mandala.kathaId,
      retiredAt: null,
    });
    expect(await nfc.resolve(publicTag)).toBe(
      `https://katha.fun/art/${mandala.kathaId}`,
    );
    expect(
      await createNfcResolutionStore(database.db, "DEVNET").find(publicTag),
    ).toBeNull();
    for (const work of [...hidden, devnet]) {
      const tagId = randomUUID();
      await tags.assign(work.kathaId, tagId, tagActor.id);
      expect(await nfcStore.find(tagId)).toBeNull();
      await expect(nfc.resolve(tagId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await tags.retire(tagId, tagActor.id);
      expect(await nfcStore.find(tagId)).toBeNull();
    }
    expect(await nfcStore.find(randomUUID())).toBeNull();
    await tags.retire(publicTag, tagActor.id);
    await expect(nfc.resolve(publicTag)).rejects.toMatchObject({
      code: "NFC_TAG_RETIRED",
    });
    const replacementTag = randomUUID();
    await tags.assign(mandala.kathaId, replacementTag, tagActor.id);
    expect(await nfc.resolve(replacementTag)).toBe(
      `https://katha.fun/art/${mandala.kathaId}`,
    );

    await database.db.insert(artworkMaterials).values([
      { artworkId: mandala.id, name: "Mineral pigments", position: 1 },
      { artworkId: mandala.id, name: "Canvas", position: 0 },
    ]);
    await database.db.insert(custodyEvents).values({
      artworkId: mandala.id,
      fromState: "UNKNOWN",
      toState: "KATHA_HELD",
      custodianWallet: wallet.address,
      recordedByWallet: wallet.address,
      evidenceHash: "e".repeat(64),
      occurredAt: new Date(),
    });
    // A newer prepared revision must not replace finalized public metadata.
    const preparedDocument = JSON.stringify({ kathaId: mandala.kathaId });
    await database.db.insert(artworkMetadataVersions).values({
      artworkId: mandala.id,
      authorityWallet: wallet.address,
      version: 3,
      status: "PREPARED",
      uri: "https://example.com/prepared.json",
      canonicalDocument: preparedDocument,
      documentHash: hash(preparedDocument),
    });
    const detailResponse = await app.request(`/artworks/${mandala.kathaId}`);
    expect(detailResponse.status).toBe(200);
    const detail = publicArtworkDetailSchema.parse(await detailResponse.json());
    expect(detail.materials).toEqual(["Canvas", "Mineral pigments"]);
    expect(detail.story).toBe("Finalized revised synthetic story");
    expect(detail.dimensions).toEqual({ heightMm: 720, widthMm: 510, depthMm: null });
    expect(detail.metadata.version).toBe(2);
    expect(detail.condition).toMatchObject({
      version: 2,
      reason: "PRE_RESALE",
      grade: "GOOD",
    });
    expect(detail.metadata.uri).toContain("/2.json");
    expect(detail.custody).toMatchObject({
      state: "KATHA_HELD",
      source: "MANUAL_OBSERVATION",
    });
    expect(detail.ownership.ownerWallet).toBe(wallet.address);
    expect(detail.indexing).toEqual({ freshness: "UNKNOWN", checkpoint: null });
    expect(detail.media.map((row) => row.role)).toEqual(["HERO"]);
    expect(JSON.stringify(detail)).not.toContain("PRIVATE");
    for (const record of [...hidden, devnet])
      expect((await app.request(`/artworks/${record.kathaId}`)).status).toBe(404);
    expect((await app.request("/artworks/KATHA-MANDALA-999999")).status).toBe(404);
    const privateDetail = publicArtworkDetailSchema.parse(
      await (await app.request(`/artworks/${privateHero.kathaId}`)).json(),
    );
    expect(privateDetail.media).toEqual([]);
    expect(privateDetail.custody).toEqual({
      state: "UNKNOWN",
      source: "UNKNOWN",
      observedAt: null,
    });
    const devnetDetail = await createPublicArtworkDetailStore(
      database.db,
      "DEVNET",
    ).findByKathaId(devnet.kathaId);
    expect(devnetDetail?.cluster).toBe("DEVNET");
    expect(
      await createPublicArtworkDetailStore(database.db, "DEVNET").findByKathaId(
        mandala.kathaId,
      ),
    ).toBeNull();
    await database.db.insert(indexerCheckpoints).values({
      cluster: "LOCALNET",
      programAddress: wallet.address,
      fromSlot: 0n,
      scannedThroughSlot: 10n,
      gapFromSlot: 2n,
      gapThroughSlot: 3n,
    });
    const gapDetail = publicArtworkDetailSchema.parse(
      await (await app.request(`/artworks/${mandala.kathaId}`)).json(),
    );
    expect(gapDetail.indexing.freshness).toBe("GAP_DETECTED");
    expect(gapDetail.indexing.checkpoint).toMatchObject({
      scannedThroughSlot: "10",
      gapFromSlot: "2",
      gapThroughSlot: "3",
    });

    const artistPage = artworkDiscoveryResponseSchema.parse(
      await (await app.request(`/artworks?artistId=${paubha.artistId}`)).json(),
    );
    expect(artistPage.items.map((work) => work.kathaId)).toEqual([paubha.kathaId]);
    expect(artistPage.items.every((work) => work.artist.id === paubha.artistId)).toBe(
      true,
    );
    expect(artistPage.pagination.hasMore).toBe(false);
    for (const record of [...hidden, devnet]) {
      const scoped = artworkDiscoveryResponseSchema.parse(
        await (await app.request(`/artworks?artistId=${record.artistId}`)).json(),
      );
      expect(scoped.items).toEqual([]);
    }
    const wrongCategory = artworkDiscoveryResponseSchema.parse(
      await (
        await app.request(`/artworks?artistId=${paubha.artistId}&category=THANGKA`)
      ).json(),
    );
    expect(wrongCategory.items).toEqual([]);
    const page = artworkDiscoveryResponseSchema.parse(
      await (await app.request("/artworks")).json(),
    );
    expect(page.items.map((row) => row.kathaId)).toEqual([
      mandala.kathaId,
      paubha.kathaId,
      privateHero.kathaId,
      thangka.kathaId,
    ]);
    expect(
      page.items.find((row) => row.kathaId === privateHero.kathaId)?.heroImage,
    ).toBeNull();
    expect(
      page.items.find((row) => row.kathaId === thangka.kathaId)?.heroImage,
    ).toBeNull();
    expect(
      page.items.find((row) => row.kathaId === paubha.kathaId)?.heroImage?.altText,
    ).toBe("Approved synthetic image");
    expect(JSON.stringify(page)).not.toContain("PRIVATE");
    expect(JSON.stringify(page)).not.toContain("b".repeat(64));
    expect(JSON.stringify(page)).not.toContain(wallet.address);
    expect(
      hidden.every(
        (record) => !page.items.some((item) => item.kathaId === record.kathaId),
      ),
    ).toBe(true);
    const filtered = artworkDiscoveryResponseSchema.parse(
      await (await app.request("/artworks?category=PAUBHA&limit=1")).json(),
    );
    expect(filtered.items.map((row) => row.kathaId)).toEqual([paubha.kathaId]);
    expect(filtered.pagination.hasMore).toBe(true);
    const next = artworkDiscoveryResponseSchema.parse(
      await (await app.request("/artworks?category=PAUBHA&limit=1&offset=1")).json(),
    );
    expect(next.items.map((row) => row.kathaId)).toEqual([privateHero.kathaId]);
    expect(next.pagination.hasMore).toBe(false);
    expect(await (await app.request("/artworks?offset=100000")).json()).toEqual({
      items: [],
      pagination: { limit: 20, offset: 100000, hasMore: false },
    });
    expect(
      (
        await createPublicArtworkStore(database.db, "DEVNET").list({
          limit: 100,
          offset: 0,
        })
      ).map((row) => row.kathaId),
    ).toEqual([devnet.kathaId]);
    // A publication marker cannot be used to reopen draft editing, even when other eligibility data is missing.
    const markerOnly = await fixture({
      verification: "MISSING",
      metadata: false,
      inspection: false,
      ownership: false,
    });
    expect(
      await createArtworkDraftStore(database.db).update(
        markerOnly.kathaId,
        markerOnly.updatedAt.toISOString(),
        { title: "Forbidden published edit" },
      ),
    ).toEqual({ status: "conflict" });
    const invalidTime = new Date();
    await expect(
      database.db.insert(artworks).values({
        artistId: markerOnly.artistId,
        category: "PAUBHA",
        title: "Invalid publication fixture",
        creationYear: 2026,
        createdAt: invalidTime,
        updatedAt: invalidTime,
        publishedAt: new Date(invalidTime.getTime() - 1),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artworks_publication_time_valid" },
    });
    const documentArtwork = await fixture({ published: false });
    const storage = createLocalStorageProvider({
      root: join(storageDirectory, ".storage"),
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1l8AAAAASUVORK5CYII=",
      "base64",
    );
    const image = await storage.put({
      bytes: png,
      mimeType: "image/png",
      visibility: "PUBLIC",
    });
    await database.db
      .$client`UPDATE artwork_media SET storage_key=${image.storageKey}, content_hash=${image.contentHash}, byte_size=${image.byteSize} WHERE artwork_id=${documentArtwork.id}`;
    await database.db
      .insert(artworkMaterials)
      .values({ artworkId: documentArtwork.id, name: "Canvas", position: 0 });
    const documents = createDocumentPreparation(
      createDocumentPreparationStore(database.db),
      storage,
      "http://localhost:3001",
    );
    const session = {
      walletAddress: wallet.address,
      walletId: randomUUID(),
      cluster: "localnet" as const,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
    const request = { expectedUpdatedAt: documentArtwork.updatedAt.toISOString() };
    const failing = createDocumentPreparation(
      createDocumentPreparationStore(database.db),
      {
        read: async () => {
          throw new Error("Synthetic storage failure");
        },
        put: storage.put,
      },
      "http://localhost:3001",
    );
    await expect(
      failing.metadata(documentArtwork.kathaId, request, session),
    ).rejects.toThrow("Synthetic storage failure");
    expect(
      await database.db.query.artworkMetadataVersions.findMany({
        where: (t, { eq }) => eq(t.artworkId, documentArtwork.id),
      }),
    ).toHaveLength(1);

    const prepared = await Promise.all(
      Array.from({ length: 4 }, () =>
        documents.metadata(documentArtwork.kathaId, request, session),
      ),
    );
    expect(new Set(prepared.map((record) => record.id)).size).toBe(1);
    expect(prepared[0]?.version).toBe(2);
    const rows = await database.db.query.artworkMetadataVersions.findMany({
      where: (t, { eq }) => eq(t.artworkId, documentArtwork.id),
      orderBy: (t, { asc }) => asc(t.version),
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe("FINALIZED");
    expect(rows[1]?.status).toBe("PREPARED");
    expect(rows[1]?.canonicalDocument).not.toContain("PRIVATE");
    await expect(
      documents.metadata(
        documentArtwork.kathaId,
        { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
        session,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const privateImage = await storage.put({
      bytes: png,
      mimeType: "image/png",
      visibility: "PRIVATE",
    });
    const [conditionMedia] = await database.db
      .insert(artworkMedia)
      .values({
        artworkId: documentArtwork.id,
        kind: "IMAGE",
        role: "CONDITION",
        visibility: "PRIVATE",
        position: 1,
        storageKey: privateImage.storageKey,
        contentHash: privateImage.contentHash,
        mimeType: "image/png",
        byteSize: BigInt(privateImage.byteSize),
      })
      .returning();
    if (!conditionMedia) throw new Error("Expected condition media");
    const inspectedAt = new Date(Date.now() - 1000).toISOString();
    const report = {
      ...request,
      reportId: randomUUID(),
      inspectorId: randomUUID(),
      grade: "GOOD",
      reason: "PRE_SALE",
      inspectedAt,
      reportedAt: inspectedAt,
      notes: "PRIVATE REPORT",
      mediaIds: [conditionMedia.id],
    };
    const condition = await documents.condition(
      documentArtwork.kathaId,
      report,
      session,
    );
    expect(condition.uri).toBeNull();
    expect(condition.version).toBe(2);
    expect(
      (await documents.condition(documentArtwork.kathaId, report, session)).id,
    ).toBe(condition.id);
    const changed = {
      ...report,
      notes: "PRIVATE SECOND REPORT",
      reportId: randomUUID(),
    };
    expect(
      (await documents.condition(documentArtwork.kathaId, changed, session)).version,
    ).toBe(3);
    await expect(
      documents.condition(
        documentArtwork.kathaId,
        { ...report, notes: "Attempt overwrite" },
        session,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const reports = await database.db.query.conditionReports.findMany({
      where: (t, { eq }) => eq(t.artworkId, documentArtwork.id),
    });
    expect(reports).toHaveLength(3);
    expect(reports.find((row) => row.id === condition.id)?.notes).toBe(
      "PRIVATE REPORT",
    );
    // Synthetic indexed history exercises the real query boundary; no transaction is sent.
    const historical = await fixture({ ownership: false });
    const [registryArtwork] = await findArtworkPda({ kathaId: historical.kathaId });
    const [coreAsset] = await findAssetPda({ artwork: registryArtwork });
    const [metadataRevision] = await findReviseMintedMetadataRevisionPda({
      artwork: registryArtwork,
      nextVersion: 1,
    });
    const [conditionReport] = await findReportPda({ reportId: Buffer.alloc(16, 1) });
    const [custodyTransition] = await findTransitionCustodyTransitionPda({
      artwork: registryArtwork,
      nextRevision: 1n,
    });
    const indexedAt = new Date();
    const sec = String(Math.floor(indexedAt.getTime() / 1000));
    const publicStore = createPublicProvenanceStore(database.db, "LOCALNET", {
      registry: KATHA_REGISTRY_PROGRAM_ADDRESS,
      core: CORE_PROGRAM_ADDRESS,
    });
    const provenance = createArtworkProvenance(publicStore);
    const historyApp = createApi(
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
      provenance,
    );
    const claims = [
      {
        name: "ArtworkRegistered",
        artwork: registryArtwork,
        kathaId: historical.kathaId,
        artistId: historical.artistId,
        creatorWallet: historical.creatorWallet,
        category: historical.category,
        creationYear: historical.creationYear,
        authorshipEvidenceHash: "e".repeat(64),
        collection: wallet.address,
        registeredBy: wallet.address,
        registeredAt: sec,
      },
      {
        name: "MetadataCommitted",
        artwork: registryArtwork,
        kathaId: historical.kathaId,
        revision: metadataRevision,
        version: 1,
        documentHash: "b".repeat(64),
        committedBy: wallet.address,
        committedAt: sec,
      },
      {
        name: "ConditionRecorded",
        artwork: registryArtwork,
        kathaId: historical.kathaId,
        report: conditionReport,
        reportId: "01".repeat(16),
        version: 1,
        reportHash: "c".repeat(64),
        grade: 0,
        reason: 0,
        verifier: wallet.address,
        inspectedAt: sec,
        recordedAt: sec,
      },
      {
        name: "CustodyUpdated",
        artwork: registryArtwork,
        kathaId: historical.kathaId,
        transition: custodyTransition,
        revision: "1",
        action: 0,
        fromState: 0,
        toState: 1,
        attestedBy: wallet.address,
        recordedAt: sec,
      },
      {
        name: "ArtworkMinted",
        artwork: registryArtwork,
        kathaId: historical.kathaId,
        asset: coreAsset,
        collection: wallet.address,
        initialOwner: wallet.address,
        ownerWallet: wallet.address,
        metadataVersion: 1,
        metadataHash: "b".repeat(64),
        mintedBy: wallet.address,
        mintedAt: sec,
      },
      {
        name: "CoreTransfer",
        asset: coreAsset,
        collection: wallet.address,
        newOwner: wallet.address,
        ownerWallet: wallet.address,
        authority: wallet.address,
      },
      {
        name: "ConditionRecorded",
        artwork: registryArtwork,
        kathaId: historical.kathaId,
        report: conditionReport,
        reportId: "01".repeat(16),
        version: 2,
        reportHash: "d".repeat(64),
        grade: 1,
        reason: 3,
        verifier: wallet.address,
        inspectedAt: sec,
        recordedAt: sec,
      },
    ];
    const historyRows = [];
    const positions = [
      [0, 0, -1, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 1, -1, 0],
      [1, 0, -1, 0],
      [1, 1, -1, 0],
      [2, 0, -1, 0],
    ] as const;
    // Insert in reverse order: response order must come from chain position, never insertion time.
    for (let n = claims.length - 1; n >= 0; n--) {
      const claim = claims[n]!;
      const [event] = await database.db
        .insert(indexedEvents)
        .values({
          cluster: "LOCALNET",
          programAddress:
            n === 5 ? CORE_PROGRAM_ADDRESS : KATHA_REGISTRY_PROGRAM_ADDRESS,
          signature: String(4 + positions[n]![0]).repeat(88),
          slot: 2n,
          transactionIndex: positions[n]![0],
          outerInstructionIndex: positions[n]![1],
          innerInstructionIndex: positions[n]![2],
          eventIndex: positions[n]![3],
          kind: n === 4 || n === 5 ? "OWNERSHIP" : "REGISTRY",
          artworkId: historical.id,
          assetAddress: n === 4 || n === 5 ? coreAsset : null,
          payload: {
            ...claim,
            privateEvidence: "PRIVATE INDEX PAYLOAD",
            notes: "PRIVATE REPORT NOTES",
            shipping: "PRIVATE FULFILLMENT",
          },
          chainRecordedAt: indexedAt,
          indexedAt,
        })
        .returning();
      if (!event) throw new Error("Expected synthetic history event");
      historyRows.unshift(event);
    }
    await database.db.insert(artworkOwnership).values({
      cluster: "LOCALNET",
      artworkId: historical.id,
      assetAddress: coreAsset,
      ownerWallet: wallet.address,
      sourceEventId: historyRows[5]!.id,
    });
    const unknownHistory = await provenance.history(historical.kathaId, {
      limit: 100,
      offset: 0,
    });
    expect(unknownHistory.indexing.status).toBe("UNKNOWN");
    expect(unknownHistory.items.map((e) => e.type)).toEqual([
      "REGISTRATION",
      "METADATA",
      "CONDITION",
      "CUSTODY",
      "MINT",
      "TRANSFER",
      "CONDITION",
    ]);
    await database.db.insert(indexerNetworks).values({
      cluster: "LOCALNET",
      registryProgram: KATHA_REGISTRY_PROGRAM_ADDRESS,
      collection: wallet.address,
      genesisHash: wallet.address,
      finalizedSlot: 2n,
    });
    await database.db.insert(indexerCheckpoints).values(
      [KATHA_REGISTRY_PROGRAM_ADDRESS, CORE_PROGRAM_ADDRESS].map((programAddress) => ({
        cluster: "LOCALNET" as const,
        programAddress,
        fromSlot: 0n,
        scannedThroughSlot: 2n,
        lastSignature: "4".repeat(88),
        lastSignatureSlot: 2n,
      })),
    );
    await database.db.insert(ownershipReconciliations).values({
      cluster: "LOCALNET",
      artworkId: historical.id,
      sourceEventId: historyRows[5]!.id,
      indexedOwner: wallet.address,
      observedOwner: wallet.address,
      observedSlot: 2n,
      status: "MATCH",
    });
    const history = artworkProvenanceResponseSchema.parse(
      await (
        await historyApp.request(`/artworks/${historical.kathaId}/provenance`)
      ).json(),
    );
    expect(history.indexing.status).toBe("AT_OBSERVED_HEAD");
    expect(history.attribution.artist.id).toBe(historical.artistId);
    expect(history.chain.coreAssetAddress).toBe(coreAsset);
    expect(history.items.map((e) => e.id)).toEqual(historyRows.map((e) => e.id));
    expect(JSON.stringify(history)).not.toContain("PRIVATE");
    const pagedIds: string[] = [];
    for (let offset = 0; offset < 8; offset += 2) {
      const page = await provenance.history(historical.kathaId, { limit: 2, offset });
      pagedIds.push(...page.items.map((e) => e.id));
      expect(page.pagination.hasMore).toBe(offset < 6);
    }
    expect(pagedIds).toEqual(historyRows.map((e) => e.id));
    const conditions = await provenance.history(historical.kathaId, {
      limit: 20,
      offset: 0,
      type: "CONDITION",
    });
    expect(
      conditions.items.map((e) => (e.type === "CONDITION" ? e.data.version : null)),
    ).toEqual([1, 2]);
    expect(JSON.stringify(conditions)).not.toContain("PRIVATE");
    for (const hiddenRecord of [...hidden, devnet])
      expect(
        (await historyApp.request(`/artworks/${hiddenRecord.kathaId}/provenance`))
          .status,
      ).toBe(404);
    expect(
      (await historyApp.request("/artworks/KATHA-PAUBHA-999999/provenance")).status,
    ).toBe(404);
    expect(
      await createPublicProvenanceStore(database.db, "DEVNET", {
        registry: KATHA_REGISTRY_PROGRAM_ADDRESS,
        core: CORE_PROGRAM_ADDRESS,
      }).find(historical.kathaId, { limit: 20, offset: 0 }),
    ).toBeNull();
    await database.db
      .$client`UPDATE indexer_checkpoints SET gap_from_slot=1, gap_through_slot=2, gap_reason='HISTORY_UNAVAILABLE' WHERE cluster='LOCALNET' AND program_address=${CORE_PROGRAM_ADDRESS}`;
    const gapHistory = await provenance.history(historical.kathaId, {
      limit: 20,
      offset: 0,
    });
    expect(gapHistory.indexing.status).toBe("GAP_DETECTED");
    expect(gapHistory.items).toHaveLength(7);
    // Synthetic finalized read-model changes exercise HTTP identity stability,
    // not a real Core transfer, sale, metadata revision or physical delivery.
    const taggedWork = await fixture();
    const stableId = taggedWork.kathaId;
    const stableUrl = `https://katha.fun/art/${stableId}`;
    const lifecycleTag = randomUUID();
    expect((await tags.assign(stableId, lifecycleTag, tagActor.id)).status).toBe(
      "assigned",
    );
    const originalBinding = await tags.get(lifecycleTag);
    const originalDetail = publicArtworkDetailSchema.parse(
      await (await app.request(`/artworks/${stableId}`)).json(),
    );
    async function redirect(tagId: string) {
      const response = await app.request(`/nfc/${tagId}`);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(stableUrl);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).not.toContain("PRIVATE");
    }
    await redirect(lifecycleTag);
    await database.db
      .$client`UPDATE artworks SET title='Synthetic revised title', updated_at=now() WHERE id=${taggedWork.id}`;
    await redirect(lifecycleTag);
    const renamed = publicArtworkDetailSchema.parse(
      await (await app.request(`/artworks/${stableId}`)).json(),
    );
    expect(renamed.title).toBe("Synthetic revised title");
    expect(renamed.kathaId).toBe(stableId);
    for (const [index, collector] of [temporaryWallet(), temporaryWallet()].entries()) {
      await database.db.$client.begin(async (transactionSql) => {
        const at = new Date().toISOString();
        const [event] = await transactionSql`
          INSERT INTO indexed_events (cluster, program_address, signature, slot,
            transaction_index, outer_instruction_index, kind, artwork_id,
            asset_address, payload, chain_recorded_at, indexed_at)
          VALUES ('LOCALNET', ${wallet.address}, ${"8".repeat(88)}, ${index + 2},
            0, ${index}, 'OWNERSHIP', ${taggedWork.id},
            ${originalDetail.chain.coreAssetAddress},
            ${JSON.stringify({ ownerWallet: collector.address, privateEvidence: "PRIVATE TRANSFER FIXTURE" })}::jsonb,
            ${at}, ${at}) RETURNING id`;
        if (!event || typeof event.id !== "string")
          throw new Error("Missing synthetic owner event");
        await transactionSql`UPDATE artwork_ownership SET owner_wallet=${collector.address}, source_event_id=${event.id} WHERE artwork_id=${taggedWork.id} AND cluster='LOCALNET'`;
      });
      await redirect(lifecycleTag);
      const changed = publicArtworkDetailSchema.parse(
        await (await app.request(`/artworks/${stableId}`)).json(),
      );
      expect(changed.ownership.ownerWallet).toBe(collector.address);
      expect(changed.artist).toEqual(originalDetail.artist);
      expect(changed.creatorWallet).toBe(originalDetail.creatorWallet);
      expect(changed.custody).toEqual(originalDetail.custody);
      expect(changed.verification).toEqual(originalDetail.verification);
      expect(changed.metadata).toEqual(originalDetail.metadata);
      expect(await tags.get(lifecycleTag)).toEqual(originalBinding);
    }
    const retiredBinding = await tags.retire(lifecycleTag, tagActor.id);
    expect(await tags.retire(lifecycleTag, tagActor.id)).toEqual(retiredBinding);
    async function retiredResponse() {
      const response = await app.request(`/nfc/${lifecycleTag}`);
      expect(response.status).toBe(410);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.text();
      expect(JSON.parse(body).error.code).toBe("NFC_TAG_RETIRED");
      expect(body).not.toContain(stableId);
    }
    await retiredResponse();
    expect(await tags.assign(stableId, lifecycleTag, tagActor.id)).toEqual({
      status: "conflict",
    });
    const nextTag = randomUUID();
    expect((await tags.assign(stableId, nextTag, tagActor.id)).status).toBe("assigned");
    await redirect(nextTag);
    await retiredResponse();
    expect(await tags.get(lifecycleTag)).toEqual(retiredBinding);
    expect((await app.request(`/artworks/${stableId}`)).status).toBe(200);
    expect((await app.request(`/nfc/${randomUUID()}`)).status).toBe(404);
    expect(logs.join("")).not.toContain("PRIVATE");
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
    await database.close();
    try {
      if (created) await parent.db.execute(`DROP DATABASE "${name}"`);
    } finally {
      await parent.close();
    }
  }
}, 15000);
