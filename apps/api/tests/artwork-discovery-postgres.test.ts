import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
  createDatabase,
  validateDatabaseUrl,
  createArtistStore,
  createPublicArtworkStore,
  createArtworkDraftStore,
  artworks,
  artworkMedia,
  verifications,
  artworkMetadataVersions,
  conditionReports,
  indexedEvents,
  artworkOwnership,
} from "@katha/db";
import { artworkDiscoveryResponseSchema } from "@katha/shared";
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
      const document = JSON.stringify({ kathaId: record.kathaId });
      for (let version = 1; version <= options.metadataVersions; version++) {
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
      const id = randomUUID();
      const inspectorId = randomUUID();
      const document = JSON.stringify({
        kathaId: record.kathaId,
        reportId: id,
        inspectorId,
        verifierWallet: wallet.address,
        grade: "EXCELLENT",
        reason: "INITIAL_VERIFICATION",
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
          version: 1,
          inspectorId,
          grade: "EXCELLENT",
          reason: "INITIAL_VERIFICATION",
          inspectedAt: at,
          reportedAt: at,
          notes: "PRIVATE INSPECTION NOTES",
          mediaHashes: ["e".repeat(64)],
          canonicalDocument: document,
          documentHash: hash(document),
        })
        .returning();
      if (!inspection) throw new Error("Expected prepared inspection");
      await finalize("condition_reports", inspection.id, 1);
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
    const mandala = await fixture({ category: "MANDALA", metadataVersions: 2 });
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
    expect(logs.join("")).not.toContain("PRIVATE");
  } finally {
    await database.close();
    try {
      if (created) await parent.db.execute(`DROP DATABASE "${name}"`);
    } finally {
      await parent.close();
    }
  }
}, 15000);
