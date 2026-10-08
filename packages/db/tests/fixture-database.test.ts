import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { count, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import {
  artists,
  artworks,
  artworkMaterials,
  artworkMedia,
  artworkMetadataVersions,
  verifications,
  conditionReports,
  custodyEvents,
  fulfillmentRequests,
  wallets,
  walletChallenges,
  walletSessions,
  blockchainOperations,
  transactionReceipts,
  indexedEvents,
  indexerCheckpoints,
  indexerNetworks,
  ownershipReconciliations,
  artworkOwnership,
  artworkListings,
  artworkSales,
  createDatabase,
  type Database,
} from "../src/index.js";
import {
  seedDraftFixtures,
  syntheticArtistId,
  syntheticDrafts,
  validateFixtureDatabaseUrl,
} from "../src/development/draft-fixtures.js";

async function withFreshDatabase(
  check: (db: Database, second: Database, url: string) => Promise<void>,
) {
  const parent = process.env.KATHA_TEST_DATABASE_URL;
  if (!parent || parent !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  validateFixtureDatabaseUrl(parent);
  const admin = createDatabase(parent);
  // Only a generated identifier is interpolated, never configuration or user text.
  const name = `katha_fixture_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(parent);
  url.pathname = `/${name}`;
  let created = false;
  let first: ReturnType<typeof createDatabase> | undefined;
  let second: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.db.execute(sql.raw(`CREATE DATABASE "${name}"`));
    created = true;
    first = createDatabase(validateFixtureDatabaseUrl(url.toString()));
    second = createDatabase(url.toString());
    const folder = fileURLToPath(new URL("../drizzle/", import.meta.url));
    await migrate(first.db, { migrationsFolder: folder });
    await migrate(first.db, { migrationsFolder: folder });
    expect(
      (
        await first.db.execute(
          sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
        )
      )[0]?.count,
    ).toBe(16);
    await check(first.db, second.db, url.toString());
  } finally {
    await first?.close();
    await second?.close();
    if (created) await admin.db.execute(sql.raw(`DROP DATABASE "${name}"`));
    await admin.close();
  }
}

it("migrates a fresh application database and seeds concurrent fictional drafts without chain claims", async () => {
  await withFreshDatabase(async (db, second, url) => {
    expect(
      (
        await db.execute(
          sql`select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
        )
      )[0]?.count,
    ).toBe(26);
    expect(
      (
        await db.execute(sql`select to_regclass('public.migration_probe') as relation`)
      )[0]?.relation,
    ).toBeNull();
    const seeds = await Promise.all([seedDraftFixtures(db), seedDraftFixtures(second)]);
    expect(seeds.map((seed) => seed.createdArtists).sort()).toEqual([0, 1]);
    expect(seeds.map((seed) => seed.createdArtworks).sort()).toEqual([0, 3]);
    expect(seeds[0]?.drafts).toEqual(seeds[1]?.drafts);
    const [artist] = await db.select().from(artists);
    expect(artist?.verificationStatus).toBe("UNVERIFIED");
    expect(artist?.creatorWallet).toBeNull();
    expect(artist?.payoutWallet).toBeNull();
    const drafts = await db.select().from(artworks);
    expect(drafts).toHaveLength(3);
    expect(drafts.map((draft) => draft.kathaId).sort()).toEqual([
      "KATHA-MANDALA-000001",
      "KATHA-PAUBHA-000001",
      "KATHA-THANGKA-000001",
    ]);
    expect(
      drafts.every(
        (draft) =>
          draft.artistId === syntheticArtistId &&
          draft.creatorWallet === null &&
          draft.authorshipEvidenceHash === null,
      ),
    ).toBe(true);
    expect(await db.select().from(artworkMaterials)).toHaveLength(6);
    for (const table of [
      artworkMedia,
      artworkMetadataVersions,
      verifications,
      conditionReports,
      custodyEvents,
      fulfillmentRequests,
      wallets,
      walletChallenges,
      walletSessions,
      blockchainOperations,
      transactionReceipts,
      indexedEvents,
      indexerCheckpoints,
      indexerNetworks,
      ownershipReconciliations,
      artworkOwnership,
      artworkListings,
      artworkSales,
    ]) {
      expect((await db.select({ count: count() }).from(table))[0]?.count).toBe(0);
    }
    // Repeated seeding leaves deliberately edited drafts and material removals intact.
    const fixture = syntheticDrafts[0];
    await db
      .update(artworks)
      .set({ title: "Synthetic edited draft" })
      .where(eq(artworks.id, fixture.id));
    await db
      .update(artists)
      .set({ biography: "Synthetic edited biography" })
      .where(eq(artists.id, syntheticArtistId));
    await db.delete(artworkMaterials).where(eq(artworkMaterials.artworkId, fixture.id));
    const repeated = await seedDraftFixtures(db);
    expect(repeated.createdArtists).toBe(0);
    expect(repeated.createdArtworks).toBe(0);
    expect(
      (await db.select().from(artworks).where(eq(artworks.id, fixture.id)))[0]?.title,
    ).toBe("Synthetic edited draft");
    expect((await db.select().from(artists))[0]?.biography).toBe(
      "Synthetic edited biography",
    );
    expect(await db.select().from(artworkMaterials)).toHaveLength(4);
    expect(
      (
        await db.execute(
          sql`select last_value from artwork_id_counters order by category`,
        )
      ).map((row) => row.last_value),
    ).toEqual([1, 1, 1]);
    const cwd = fileURLToPath(new URL("../", import.meta.url));
    execFileSync("pnpm", ["build"], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = execFileSync(process.execPath, ["dist/development/seed-drafts.js"], {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, DATABASE_URL: url },
    });
    expect(output).toContain("0 artist and 0 artworks created");
    expect(output).not.toContain(url);
    // Fresh migrations include their reviewed lifecycle guards, not just table snapshots.
    await expect(
      db
        .update(artworks)
        .set({ artistId: randomUUID() })
        .where(eq(artworks.id, fixture.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artworks_identity_immutable" },
    });
    await expect(
      db.delete(artists).where(eq(artists.id, syntheticArtistId)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    await expect(
      db.insert(artworkMaterials).values({
        artworkId: randomUUID(),
        position: 0,
        name: "Synthetic missing parent",
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db.insert(artists).values({
        slug: "invalid artist",
        displayName: "Synthetic",
        biography: "Synthetic",
        region: "Synthetic",
        traditions: ["Paubha"],
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artists_slug_format" },
    });
  });
}, 30_000);

it("rolls back all fictional seed writes and allocations when a reserved identity conflicts", async () => {
  await withFreshDatabase(async (db) => {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "synthetic-conflicting-artist",
        displayName: "Synthetic conflict",
        biography: "Synthetic fixture",
        region: "Synthetic",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Conflict artist missing");
    await db.insert(artworks).values({
      id: syntheticDrafts[2].id,
      artistId: artist.id,
      category: "PAUBHA",
      title: "Synthetic conflicting artwork",
      creationYear: 2026,
    });
    await expect(seedDraftFixtures(db)).rejects.toThrow(
      "Reserved synthetic artwork identity conflicts",
    );
    expect(
      await db.select().from(artists).where(eq(artists.id, syntheticArtistId)),
    ).toHaveLength(0);
    expect(await db.select().from(artworks)).toHaveLength(1);
    expect(await db.select().from(artworkMaterials)).toHaveLength(0);
    expect(
      await db.execute(sql`select category, last_value from artwork_id_counters`),
    ).toMatchObject([{ category: "PAUBHA", last_value: 1 }]);
  });
}, 30_000);
