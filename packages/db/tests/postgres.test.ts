import { createNfcTagStore, nfcTags } from "../src/index.js";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import {
  artists,
  indexedEvents,
  indexerCheckpoints,
  artworkOwnership,
  artworkListings,
  artworkSales,
  type NewIndexedEventRecord,
  blockchainOperations,
  transactionReceipts,
  type NewBlockchainOperationRecord,
  wallets,
  walletChallenges,
  walletSessions,
  custodyEvents,
  fulfillmentRequests,
  type NewFulfillmentRequestRecord,
  artworkMetadataVersions,
  verifications,
  conditionReports,
  type NewConditionReportRecord,
  artworkMedia,
  artworkMaterials,
  type NewArtworkMediaRecord,
  createDatabase,
  artworks,
  type NewArtworkRecord,
  type NewArtistRecord,
} from "../src/index.js";

it("generates forward migrations, applies them once, and rolls back failed transactions and migrations", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test with its disposable database");
  const connection = createDatabase(url);
  const folder = await mkdtemp(join(tmpdir(), "katha-migrations-"));
  const migrations = join(folder, "drizzle");
  const config = join(folder, "drizzle.config.ts");
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const bin = join(cwd, "node_modules/drizzle-kit/bin.cjs");
  const cli = (...args: string[]) =>
    execFileSync(process.execPath, [bin, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    // Exercise the real application migration command, including all application migrations.
    cli("migrate");
    cli("migrate");
    const applicationCount = (
      await connection.db.execute(
        sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
      )
    )[0]?.count;
    expect(applicationCount).toBe(13);
    await writeFile(
      config,
      `export default ${JSON.stringify({
        dialect: "postgresql",
        schema: join(cwd, "tests/fixtures/schema.ts"),
        out: migrations,
        dbCredentials: { url },
      })};\n`,
    );
    cli("generate", "--config", config);
    cli("migrate", "--config", config);
    cli("migrate", "--config", config);
    const result = await connection.db.execute(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    expect(result[0]?.count).toBe(Number(applicationCount) + 1);
    await connection.db.transaction(async (tx) => {
      await tx.execute(sql`insert into migration_probe (id) values (1)`);
    });
    await expect(
      connection.db.transaction(async (tx) => {
        await tx.execute(sql`insert into migration_probe (id) values (2)`);
        await tx.execute(sql`insert into migration_probe (id) values (1)`);
      }),
    ).rejects.toThrow();
    const rows = await connection.db.execute(
      sql`select id from migration_probe order by id`,
    );
    expect(rows.map((row) => row.id)).toEqual([1]);

    const journalPath = join(migrations, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: {
        idx: number;
        version: string;
        when: number;
        tag: string;
        breakpoints: boolean;
      }[];
    };
    const first = journal.entries[0];
    if (!first) throw new Error("Generated migration journal is empty");
    journal.entries.push({
      idx: 1,
      version: first.version,
      when: first.when + 1,
      tag: "0001_failed_fixture",
      breakpoints: true,
    });
    await writeFile(journalPath, JSON.stringify(journal));
    await writeFile(
      join(migrations, "0001_failed_fixture.sql"),
      "CREATE TABLE rollback_probe (id integer);\n--> statement-breakpoint\nINSERT INTO missing_fixture_table VALUES (1);\n",
    );
    await expect(
      migrate(connection.db, { migrationsFolder: migrations }),
    ).rejects.toThrow();
    expect(
      (
        await connection.db.execute(
          sql`select to_regclass('public.rollback_probe') as relation`,
        )
      )[0]?.relation,
    ).toBeNull();
    expect(
      (
        await connection.db.execute(
          sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
        )
      )[0]?.count,
    ).toBe(Number(applicationCount) + 1);
    await connection.close();
    await expect(connection.db.execute(sql`select 1`)).rejects.toThrow();
  } finally {
    await connection.close();
    await rm(folder, { recursive: true, force: true });
  }
}, 60_000);

it("enforces artist identity, optional wallets, profile content and manual verification constraints", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const { db } = connection;
  const fixture: NewArtistRecord = {
    slug: "synthetic-artist",
    displayName: "Synthetic Artist",
    biography: "Synthetic biography",
    region: "Lalitpur",
    traditions: ["Paubha"],
  };
  const wallet = "Vote111111111111111111111111111111111111111";
  try {
    const [artist] = await db.insert(artists).values(fixture).returning();
    if (!artist) throw new Error("Artist insert returned no row");
    expect(artist.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(artist.creatorWallet).toBeNull();
    expect(artist.payoutWallet).toBeNull();
    expect(artist.publicLinks).toEqual([]);
    expect(artist.verificationStatus).toBe("UNVERIFIED");
    expect(artist.verifiedAt).toBeNull();
    expect(artist.verifiedByWallet).toBeNull();
    await expect(db.insert(artists).values(fixture)).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "artists_slug_unique" },
    });
    await expect(
      db.insert(artists).values({ ...fixture, id: artist.id, slug: "duplicate-id" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "artists_pkey" },
    });
    const invalid: { change: Partial<NewArtistRecord>; constraint: string }[] = [
      { change: { slug: "Uppercase" }, constraint: "artists_slug_format" },
      { change: { slug: "bad--slug" }, constraint: "artists_slug_format" },
      { change: { displayName: "\n\t " }, constraint: "artists_display_name_nonblank" },
      { change: { biography: " " }, constraint: "artists_biography_nonblank" },
      { change: { region: " " }, constraint: "artists_region_nonblank" },
      { change: { traditions: [] }, constraint: "artists_traditions_valid" },
      {
        change: { traditions: ["Paubha", " "] },
        constraint: "artists_traditions_valid",
      },
      {
        change: { traditions: Array(21).fill("Paubha") },
        constraint: "artists_traditions_valid",
      },
      {
        change: { publicLinks: ["javascript:invalid"] },
        constraint: "artists_public_links_valid",
      },
      {
        change: { publicLinks: Array(11).fill("https://example.com") },
        constraint: "artists_public_links_valid",
      },
      {
        change: { profileImageUrl: "file:///private" },
        constraint: "artists_profile_image_url_format",
      },
      {
        change: { creatorWallet: "invalid0" },
        constraint: "artists_creator_wallet_format",
      },
      { change: { payoutWallet: "" }, constraint: "artists_payout_wallet_format" },
      {
        change: { verificationStatus: "VERIFIED" },
        constraint: "artists_manual_verification_complete",
      },
      {
        change: { verifiedByWallet: wallet },
        constraint: "artists_manual_verification_complete",
      },
      { change: { updatedAt: new Date(0) }, constraint: "artists_timestamp_order" },
    ];
    for (const { change, constraint } of invalid) {
      await expect(
        db.insert(artists).values({ ...fixture, slug: "invalid-fixture", ...change }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: constraint },
      });
    }
    await expect(
      db.execute(
        sql`insert into artists (slug, display_name, biography, region, traditions) values ('null-tradition', 'Synthetic', 'Synthetic', 'Synthetic', ARRAY[NULL]::text[])`,
      ),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artists_traditions_valid" },
    });
    await expect(
      db.execute(
        sql`insert into artists (slug, display_name, biography, region, traditions) values ('null-name', NULL, 'Synthetic', 'Synthetic', ARRAY['Paubha'])`,
      ),
    ).rejects.toMatchObject({ cause: { code: "23502" } });
    await expect(
      db
        .insert(artists)
        .values({ ...fixture, slug: "long-name", displayName: "x".repeat(161) }),
    ).rejects.toMatchObject({ cause: { code: "22001" } });
    await expect(
      db
        .insert(artists)
        .values({ ...fixture, slug: "long-tradition", traditions: ["x".repeat(121)] }),
    ).rejects.toMatchObject({ cause: { code: "22001" } });
    // Payout identity can be shared and does not imply authorship or verification.
    const [payoutOnly] = await db
      .insert(artists)
      .values({
        ...fixture,
        slug: "payout-only",
        payoutWallet: wallet,
        publicLinks: ["https://example.com/artist"],
        profileImageUrl: "https://example.com/artist.png",
      })
      .returning();
    expect(payoutOnly?.creatorWallet).toBeNull();
    expect(payoutOnly?.verificationStatus).toBe("UNVERIFIED");
    await db.insert(artists).values({
      ...fixture,
      slug: "shared-payout",
      creatorWallet: wallet,
      payoutWallet: wallet,
    });
    const verifiedAt = new Date();
    const [verified] = await db
      .update(artists)
      .set({
        verificationStatus: "VERIFIED",
        verifiedByWallet: wallet,
        verifiedAt,
        updatedAt: verifiedAt,
      })
      .where(eq(artists.id, artist.id))
      .returning();
    expect(verified?.id).toBe(artist.id);
    expect(verified?.displayName).toBe(fixture.displayName);
    expect(verified?.creatorWallet).toBeNull();
    expect(verified?.verifiedByWallet).toBe(wallet);
    await expect(
      db
        .update(artists)
        .set({ verifiedByWallet: null })
        .where(eq(artists.id, artist.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artists_manual_verification_complete" },
    });
    expect(
      (await db.select().from(artists).where(eq(artists.id, artist.id)))[0]
        ?.verificationStatus,
    ).toBe("VERIFIED");
  } finally {
    await connection.close();
  }
});

it("allocates permanent artwork identities concurrently and enforces attribution and dimensions", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const first = createDatabase(url);
  const second = createDatabase(url);
  const db = first.db;
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "artwork-artist",
        displayName: "Synthetic Artist",
        biography: "Synthetic biography",
        region: "Lalitpur",
        traditions: ["Paubha"],
        creatorWallet: "Vote111111111111111111111111111111111111111",
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const input: NewArtworkRecord = {
      artistId: artist.id,
      category: "PAUBHA",
      title: "Synthetic Paubha",
      creationYear: 2026,
    };
    const rows = (
      await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          (index % 2 ? db : second.db)
            .insert(artworks)
            .values({ ...input, title: `Synthetic ${index}` })
            .returning(),
        ),
      )
    ).flat();
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((row) => row.kathaId)).size).toBe(24);
    expect(rows.map((row) => row.kathaId).sort()).toEqual(
      Array.from(
        { length: 24 },
        (_, i) => `KATHA-PAUBHA-${String(i + 1).padStart(6, "0")}`,
      ),
    );
    expect(rows.every((row) => row.creatorWallet === artist.creatorWallet)).toBe(true);
    expect(rows.every((row) => row.heightMm === null && row.widthMm === null)).toBe(
      true,
    );
    const [mandala] = await db
      .insert(artworks)
      .values({ ...input, category: "MANDALA" })
      .returning();
    expect(mandala?.kathaId).toBe("KATHA-MANDALA-000001");
    const [sample] = rows;
    if (!sample) throw new Error("Artwork missing");
    const invalid: { change: Partial<NewArtworkRecord>; constraint: string }[] = [
      {
        change: { heightMm: 0, widthMm: 100 },
        constraint: "artworks_dimensions_valid",
      },
      { change: { heightMm: 100 }, constraint: "artworks_dimensions_valid" },
      { change: { depthMm: 10 }, constraint: "artworks_dimensions_valid" },
      {
        change: { heightMm: 100, widthMm: -1 },
        constraint: "artworks_dimensions_valid",
      },
      {
        change: { heightMm: 100, widthMm: 100, depthMm: 0 },
        constraint: "artworks_dimensions_valid",
      },
      { change: { creationYear: 0 }, constraint: "artworks_creation_year_range" },
      { change: { creationYear: 10000 }, constraint: "artworks_creation_year_range" },
      { change: { title: " " }, constraint: "artworks_title_nonblank" },
      {
        change: { originCountryCode: "np" },
        constraint: "artworks_country_code_format",
      },
      {
        change: { authorshipEvidenceHash: "ZZ".repeat(32) },
        constraint: "artworks_authorship_hash_format",
      },
    ];
    for (const { change, constraint } of invalid) {
      await expect(
        db.insert(artworks).values({ ...input, ...change }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: constraint },
      });
    }
    await expect(
      db
        .insert(artworks)
        .values({ ...input, artistId: "123e4567-e89b-42d3-a456-426614174000" }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db.insert(artworks).values({ ...input, kathaId: sample.kathaId }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artworks_id_database_allocated" },
    });
    await expect(
      db
        .insert(artworks)
        .values({ ...input, creatorWallet: "11111111111111111111111111111111" }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artworks_creator_attribution" },
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(artworks).values(input);
        throw new Error("Synthetic rollback");
      }),
    ).rejects.toThrow("Synthetic rollback");
    const [next] = await db
      .insert(artworks)
      .values({ ...input, heightMm: 720, widthMm: 510, depthMm: 10 })
      .returning();
    expect(next?.kathaId).toBe("KATHA-PAUBHA-000025");
    for (const change of [
      { kathaId: "KATHA-PAUBHA-999999" },
      { category: "THANGKA" as const },
      { artistId: "123e4567-e89b-42d3-a456-426614174000" },
      { creatorWallet: null },
      { creationYear: 2025 },
    ]) {
      await expect(
        db.update(artworks).set(change).where(eq(artworks.id, sample.id)),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: "artworks_identity_immutable" },
      });
    }
    await db
      .update(artworks)
      .set({
        title: "Updated synthetic title",
        story: "Synthetic story",
        heightMm: 720,
        widthMm: 510,
        authorshipEvidenceHash: "07".repeat(32),
        updatedAt: new Date(),
      })
      .where(eq(artworks.id, sample.id));
    await expect(
      db
        .update(artworks)
        .set({ authorshipEvidenceHash: "08".repeat(32) })
        .where(eq(artworks.id, sample.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artworks_identity_immutable" },
    });
    await expect(
      db.delete(artworks).where(eq(artworks.id, sample.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artworks_identity_immutable" },
    });
    await expect(
      db.delete(artists).where(eq(artists.id, artist.id)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    await expect(
      db
        .update(artists)
        .set({ id: "123e4567-e89b-42d3-a456-426614174000" })
        .where(eq(artists.id, artist.id)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    await db
      .update(artists)
      .set({ creatorWallet: null })
      .where(eq(artists.id, artist.id));
    const [preserved] = await db
      .select()
      .from(artworks)
      .where(eq(artworks.id, sample.id));
    expect(preserved?.kathaId).toBe(sample.kathaId);
    expect(preserved?.creatorWallet).toBe(artist.creatorWallet);
    const [walletless] = await db
      .insert(artworks)
      .values({ ...input, category: "THANGKA" })
      .returning();
    expect(walletless?.creatorWallet).toBeNull();
    expect(walletless?.kathaId).toBe("KATHA-THANGKA-000001");
    await db.execute(
      sql`update artwork_id_counters set last_value = 999999 where category = 'THANGKA'`,
    );
    await expect(
      db.insert(artworks).values({ ...input, category: "THANGKA" }),
    ).rejects.toMatchObject({
      cause: { code: "22003", constraint_name: "artwork_id_counters_range" },
    });
    await expect(
      db.execute(
        sql`update artwork_id_counters set last_value = 1 where category = 'THANGKA'`,
      ),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_id_counters_monotonic" },
    });
    await expect(
      db.execute(sql`delete from artwork_id_counters where category = 'THANGKA'`),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_id_counters_monotonic" },
    });
  } finally {
    await first.close();
    await second.close();
  }
}, 30_000);

it("stores ordered media privately by default and distinct relational materials", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "media-artist",
        displayName: "Synthetic Media Artist",
        biography: "Synthetic biography",
        region: "Patan",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const rows = await db
      .insert(artworks)
      .values([
        {
          artistId: artist.id,
          category: "MANDALA",
          title: "Synthetic media work",
          creationYear: 2026,
        },
        {
          artistId: artist.id,
          category: "MANDALA",
          title: "Other synthetic work",
          creationYear: 2026,
        },
      ])
      .returning();
    const [work, other] = rows;
    if (!work || !other) throw new Error("Artwork missing");
    const input: NewArtworkMediaRecord = {
      artworkId: work.id,
      position: 0,
      kind: "IMAGE",
      role: "HERO",
      storageKey: "synthetic/front.jpg",
      contentHash: "09".repeat(32),
      mimeType: "image/jpeg",
      byteSize: 1024n,
    };
    const [hero] = await db.insert(artworkMedia).values(input).returning();
    if (!hero) throw new Error("Media missing");
    expect(hero.visibility).toBe("PRIVATE");
    expect(hero.byteSize).toBe(1024n);
    const [detail] = await db
      .insert(artworkMedia)
      .values({
        ...input,
        position: 1,
        role: "DETAIL",
        visibility: "PUBLIC",
        altText: "Synthetic pigment detail",
        storageKey: "synthetic/detail.jpg",
        contentHash: "0a".repeat(32),
      })
      .returning();
    if (!detail) throw new Error("Detail missing");
    await db.insert(artworkMedia).values([
      {
        ...input,
        position: 2,
        kind: "DOCUMENT",
        role: "CERTIFICATE",
        mimeType: "application/pdf",
        storageKey: "synthetic/evidence.pdf",
      },
      {
        ...input,
        position: 3,
        kind: "VIDEO",
        role: "DOCUMENTARY",
        mimeType: "video/mp4",
        storageKey: "synthetic/process.mp4",
        visibility: "PUBLIC",
      },
      { ...input, artworkId: other.id },
    ]);
    const publicMedia = () =>
      db
        .select()
        .from(artworkMedia)
        .where(
          and(
            eq(artworkMedia.artworkId, work.id),
            eq(artworkMedia.visibility, "PUBLIC"),
          ),
        )
        .orderBy(asc(artworkMedia.position));
    expect((await publicMedia()).map((row) => row.role)).toEqual([
      "DETAIL",
      "DOCUMENTARY",
    ]);
    await expect(
      db.insert(artworkMedia).values({ ...input, role: "BACK" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "artwork_media_position_unique" },
    });
    await expect(
      db.insert(artworkMedia).values({ ...input, position: 4 }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "artwork_media_hero_unique" },
    });
    const invalidMedia: {
      change: Partial<NewArtworkMediaRecord>;
      constraint: string;
    }[] = [
      { change: { position: -1 }, constraint: "artwork_media_position_valid" },
      {
        change: { contentHash: "ZZ".repeat(32) },
        constraint: "artwork_media_hash_format",
      },
      { change: { byteSize: 0n }, constraint: "artwork_media_size_positive" },
      {
        change: { mimeType: "image/svg+xml" },
        constraint: "artwork_media_mime_kind_valid",
      },
      {
        change: { kind: "VIDEO", mimeType: "image/jpeg" },
        constraint: "artwork_media_mime_kind_valid",
      },
      {
        change: { kind: "VIDEO", role: "HERO", mimeType: "video/webm" },
        constraint: "artwork_media_hero_image",
      },
      { change: { visibility: "PUBLIC" }, constraint: "artwork_media_alt_text_valid" },
      { change: { altText: " " }, constraint: "artwork_media_alt_text_valid" },
      { change: { caption: " " }, constraint: "artwork_media_caption_nonblank" },
      ...[
        "/tmp/private.jpg",
        "../evidence.jpg",
        "synthetic/../evidence.jpg",
        "synthetic/./front.jpg",
        "https://example.invalid/a?token=secret",
        "synthetic//front.jpg",
        "synthetic/",
      ].map((storageKey) => ({
        change: { storageKey },
        constraint: "artwork_media_storage_key_valid",
      })),
    ];
    for (const { change, constraint } of invalidMedia) {
      await expect(
        db
          .insert(artworkMedia)
          .values({ ...input, position: 4, role: "OTHER", ...change }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: constraint },
      });
    }
    await expect(
      db
        .insert(artworkMedia)
        .values({ ...input, artworkId: "123e4567-e89b-42d3-a456-426614174000" }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    // Immediate unique positions require a spare slot during a transactional swap.
    await db.transaction(async (tx) => {
      await tx
        .update(artworkMedia)
        .set({ position: 10 })
        .where(eq(artworkMedia.id, hero.id));
      await tx
        .update(artworkMedia)
        .set({ position: 0 })
        .where(eq(artworkMedia.id, detail.id));
      await tx
        .update(artworkMedia)
        .set({
          position: 1,
          visibility: "PUBLIC",
          altText: "Synthetic front view",
          updatedAt: new Date(),
        })
        .where(eq(artworkMedia.id, hero.id));
    });
    expect((await publicMedia()).map((row) => row.id)).toEqual([
      detail.id,
      hero.id,
      expect.any(String),
    ]);
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(artworkMedia)
          .set({ visibility: "PUBLIC" })
          .where(
            and(eq(artworkMedia.artworkId, work.id), eq(artworkMedia.position, 2)),
          );
        await tx
          .update(artworkMedia)
          .set({ position: 0 })
          .where(eq(artworkMedia.id, hero.id));
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    expect((await publicMedia()).map((row) => row.role)).toEqual([
      "DETAIL",
      "HERO",
      "DOCUMENTARY",
    ]);

    const materials = await db
      .insert(artworkMaterials)
      .values([
        { artworkId: work.id, name: "Natural mineral pigments", position: 1 },
        { artworkId: work.id, name: "Cotton canvas", position: 0 },
        { artworkId: other.id, name: "Cotton canvas", position: 0 },
      ])
      .returning();
    expect(
      (
        await db
          .select()
          .from(artworkMaterials)
          .where(eq(artworkMaterials.artworkId, work.id))
          .orderBy(asc(artworkMaterials.position))
      ).map((row) => row.name),
    ).toEqual(["Cotton canvas", "Natural mineral pigments"]);
    for (const name of [
      "",
      " ",
      " cotton canvas",
      "cotton canvas ",
      "canvas,pigments",
    ]) {
      await expect(
        db.insert(artworkMaterials).values({ artworkId: work.id, name, position: 2 }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: "artwork_materials_name_valid" },
      });
    }
    await expect(
      db
        .insert(artworkMaterials)
        .values({ artworkId: work.id, name: "COTTON CANVAS", position: 2 }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "artwork_materials_name_unique" },
    });
    await expect(
      db
        .insert(artworkMaterials)
        .values({ artworkId: work.id, name: "Gold", position: 0 }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint_name: "artwork_materials_position_unique" },
    });
    await expect(
      db
        .insert(artworkMaterials)
        .values({ artworkId: work.id, name: "Gold", position: -1 }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_materials_position_valid" },
    });
    await expect(
      db
        .insert(artworkMaterials)
        .values({ artworkId: work.id, name: "x".repeat(121), position: 2 }),
    ).rejects.toMatchObject({ cause: { code: "22001" } });
    await expect(
      db.insert(artworkMaterials).values({
        artworkId: "123e4567-e89b-42d3-a456-426614174000",
        name: "Gold",
        position: 0,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db
        .update(artworkMedia)
        .set({ artworkId: "123e4567-e89b-42d3-a456-426614174000" })
        .where(eq(artworkMedia.id, hero.id)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const material = materials[0];
    if (!material) throw new Error("Material missing");
    await expect(
      db
        .update(artworkMaterials)
        .set({ artworkId: "123e4567-e89b-42d3-a456-426614174000" })
        .where(eq(artworkMaterials.id, material.id)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await db.delete(artworkMedia).where(eq(artworkMedia.id, detail.id));
    await db.delete(artworkMaterials).where(eq(artworkMaterials.id, material.id));
    expect(
      (await db.select().from(artworks).where(eq(artworks.id, work.id)))[0]?.kathaId,
    ).toBe(work.kathaId);
  } finally {
    await connection.close();
  }
}, 30_000);

it("preserves prepared and finalized metadata, verification and condition documents", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const wallet = "Vote111111111111111111111111111111111111111";
  const inspectedAt = new Date("2026-09-30T10:00:00.000Z");
  const reportedAt = new Date("2026-09-30T10:01:00.000Z");
  const finalizedAt = new Date("2026-09-30T10:03:00.000Z");
  const receipt = {
    status: "FINALIZED" as const,
    chainCluster: "LOCALNET" as const,
    chainSignature: "1".repeat(64),
    chainSlot: 42n,
    chainRecordedAt: new Date("2026-09-30T10:02:00.000Z"),
    finalizedAt,
  };
  const versionedReceipt = { ...receipt, chainVersion: 1 };
  const commitment = (value: unknown) => {
    const canonicalDocument = JSON.stringify(value);
    return {
      canonicalDocument,
      documentHash: createHash("sha256")
        .update(canonicalDocument, "utf8")
        .digest("hex"),
    };
  };
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "attestation-artist",
        displayName: "Synthetic inspector artist",
        biography: "Synthetic biography",
        region: "Patan",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic attestation artwork",
        creationYear: 2026,
      })
      .returning();
    if (!artwork) throw new Error("Artwork missing");
    const firstDocument = commitment({
      kathaId: artwork.kathaId,
      story: "Synthetic कथा",
    });
    const metadataInput = {
      artworkId: artwork.id,
      authorityWallet: wallet,
      version: 1,
      uri: "https://example.invalid/metadata/1.json",
      ...firstDocument,
    };
    const [metadata] = await db
      .insert(artworkMetadataVersions)
      .values(metadataInput)
      .returning();
    if (!metadata) throw new Error("Metadata missing");
    expect(metadata.status).toBe("DRAFT");
    expect(metadata.canonicalDocument).toBe(firstDocument.canonicalDocument);
    expect(metadata.documentHash).toBe(firstDocument.documentHash);
    await expect(
      db
        .update(artworkMetadataVersions)
        .set({ ...versionedReceipt })
        .where(eq(artworkMetadataVersions.id, metadata.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_transition" },
    });
    await expect(
      db
        .insert(artworkMetadataVersions)
        .values({ ...metadataInput, version: 2, ...versionedReceipt }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_transition" },
    });
    await expect(
      db
        .insert(artworkMetadataVersions)
        .values({ ...metadataInput, version: 2, documentHash: "00".repeat(32) }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "metadata_versions_document_integrity" },
    });
    await expect(
      db.insert(artworkMetadataVersions).values({
        ...metadataInput,
        version: 2,
        canonicalDocument: `${firstDocument.canonicalDocument}\n`,
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "metadata_versions_document_integrity" },
    });
    await expect(
      db
        .insert(artworkMetadataVersions)
        .values({ ...metadataInput, version: 2, chainSlot: 1n }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "metadata_versions_receipt_complete" },
    });
    await expect(
      db.insert(artworkMetadataVersions).values({ ...metadataInput, version: 0 }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "metadata_versions_version_valid" },
    });
    await expect(
      db.insert(artworkMetadataVersions).values({
        ...metadataInput,
        version: 2,
        uri: "https://user:password@example.invalid/a",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "metadata_versions_uri_valid" },
    });
    await expect(
      db.insert(artworkMetadataVersions).values({
        ...metadataInput,
        version: 2,
        status: "PREPARED",
        ...commitment({ kathaId: "KATHA-PAUBHA-999999" }),
      }),
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint_name: "artwork_attestation_document_identity",
      },
    });
    await expect(
      db.insert(artworkMetadataVersions).values(metadataInput),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint_name: "metadata_versions_artwork_version_unique",
      },
    });
    await db
      .update(artworkMetadataVersions)
      .set({ status: "PREPARED" })
      .where(eq(artworkMetadataVersions.id, metadata.id));
    for (const change of [
      { status: "DRAFT" as const },
      { uri: "https://example.invalid/changed.json" },
      { ...commitment({ kathaId: artwork.kathaId, story: "Tampered" }) },
    ]) {
      await expect(
        db
          .update(artworkMetadataVersions)
          .set(change)
          .where(eq(artworkMetadataVersions.id, metadata.id)),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: "artwork_attestation_immutable" },
      });
    }
    await expect(
      db
        .delete(artworkMetadataVersions)
        .where(eq(artworkMetadataVersions.id, metadata.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_immutable" },
    });
    await expect(
      db
        .update(artworkMetadataVersions)
        .set({ status: "FINALIZED", chainVersion: 1 })
        .where(eq(artworkMetadataVersions.id, metadata.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "metadata_versions_receipt_complete" },
    });
    await db
      .update(artworkMetadataVersions)
      .set(versionedReceipt)
      .where(eq(artworkMetadataVersions.id, metadata.id));
    await expect(
      db
        .update(artworkMetadataVersions)
        .set({ chainSlot: 43n })
        .where(eq(artworkMetadataVersions.id, metadata.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_immutable" },
    });
    await db.insert(artworkMetadataVersions).values({
      ...metadataInput,
      version: 2,
      status: "PREPARED",
      uri: "https://example.invalid/metadata/2.json",
      ...commitment({ kathaId: artwork.kathaId, story: "New version" }),
    });
    expect(
      (
        await db
          .select()
          .from(artworkMetadataVersions)
          .where(eq(artworkMetadataVersions.artworkId, artwork.id))
          .orderBy(asc(artworkMetadataVersions.version))
      ).map((row) => row.documentHash),
    ).toEqual([
      firstDocument.documentHash,
      commitment({ kathaId: artwork.kathaId, story: "New version" }).documentHash,
    ]);

    // Local version 2 stays prepared after an abandoned attempt; chain version 2
    // can commit a later immutable document without rewriting that attempt.
    const [retry] = await db
      .insert(artworkMetadataVersions)
      .values({
        ...metadataInput,
        version: 3,
        status: "PREPARED",
        ...commitment({ kathaId: artwork.kathaId, story: "Reviewed retry" }),
      })
      .returning();
    if (!retry) throw new Error("Retry missing");
    await db
      .update(artworkMetadataVersions)
      .set({ ...versionedReceipt, chainVersion: 2 })
      .where(eq(artworkMetadataVersions.id, retry.id));
    const [duplicateRevision] = await db
      .insert(artworkMetadataVersions)
      .values({
        ...metadataInput,
        version: 4,
        status: "PREPARED",
      })
      .returning();
    if (!duplicateRevision) throw new Error("Duplicate revision missing");
    await expect(
      db
        .update(artworkMetadataVersions)
        .set({ ...versionedReceipt, chainVersion: 2 })
        .where(eq(artworkMetadataVersions.id, duplicateRevision.id)),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint_name: "metadata_versions_chain_version_unique",
      },
    });

    const evidenceHash = "12".repeat(32);
    const verificationInput = {
      artworkId: artwork.id,
      authorityWallet: wallet,
      inspectedAt,
      evidenceHash,
      ...commitment({
        kathaId: artwork.kathaId,
        verifierWallet: wallet,
        evidenceHash,
        inspectedAt: inspectedAt.toISOString(),
      }),
    };
    const [verification] = await db
      .insert(verifications)
      .values({ ...verificationInput, status: "PREPARED" })
      .returning();
    if (!verification) throw new Error("Verification missing");
    await expect(
      db.insert(verifications).values({
        ...verificationInput,
        evidenceHash: "13".repeat(32),
        status: "PREPARED",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "verifications_document_fields" },
    });
    await db
      .update(verifications)
      .set(receipt)
      .where(eq(verifications.id, verification.id));
    const [duplicate] = await db
      .insert(verifications)
      .values({ ...verificationInput, status: "PREPARED" })
      .returning();
    if (!duplicate) throw new Error("Duplicate missing");
    await expect(
      db.update(verifications).set(receipt).where(eq(verifications.id, duplicate.id)),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint_name: "verifications_finalized_artwork_unique",
      },
    });
    expect(
      (
        await db.select().from(verifications).where(eq(verifications.id, duplicate.id))
      )[0]?.status,
    ).toBe("PREPARED");
    await expect(
      db.delete(verifications).where(eq(verifications.id, verification.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_immutable" },
    });

    const reportId = randomUUID();
    const inspectorId = randomUUID();
    const mediaHashes = ["14".repeat(32)];
    const reportInput: NewConditionReportRecord = {
      id: reportId,
      artworkId: artwork.id,
      version: 1,
      authorityWallet: wallet,
      inspectorId,
      grade: "EXCELLENT",
      reason: "INITIAL_VERIFICATION",
      inspectedAt,
      reportedAt,
      notes: "Synthetic inspection notes",
      mediaHashes,
    };
    const reportDocument = (id: string, notes: string, hashes = mediaHashes) =>
      commitment({
        reportId: id,
        kathaId: artwork.kathaId,
        inspectorId,
        verifierWallet: wallet,
        grade: "EXCELLENT",
        reason: "INITIAL_VERIFICATION",
        inspectedAt: inspectedAt.toISOString(),
        reportedAt: reportedAt.toISOString(),
        notes,
        mediaHashes: hashes,
      });
    await db.insert(conditionReports).values(reportInput);
    await db
      .update(conditionReports)
      .set({ notes: "Updated synthetic inspection" })
      .where(eq(conditionReports.id, reportId));
    await expect(
      db
        .update(conditionReports)
        .set({ status: "PREPARED", ...reportDocument(reportId, "Wrong notes") })
        .where(eq(conditionReports.id, reportId)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "condition_reports_document_fields" },
    });
    await db
      .update(conditionReports)
      .set({
        status: "PREPARED",
        ...reportDocument(reportId, "Updated synthetic inspection"),
      })
      .where(eq(conditionReports.id, reportId));
    await expect(
      db
        .update(conditionReports)
        .set({ notes: "Overwrite" })
        .where(eq(conditionReports.id, reportId)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_immutable" },
    });
    await expect(
      db
        .update(conditionReports)
        .set({ ...versionedReceipt, chainSlot: -1n })
        .where(eq(conditionReports.id, reportId)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "condition_reports_receipt_complete" },
    });
    await expect(
      db
        .update(conditionReports)
        .set({ ...versionedReceipt, chainCluster: null })
        .where(eq(conditionReports.id, reportId)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "condition_reports_receipt_complete" },
    });
    await db
      .update(conditionReports)
      .set(versionedReceipt)
      .where(eq(conditionReports.id, reportId));
    await expect(
      db.delete(conditionReports).where(eq(conditionReports.id, reportId)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "artwork_attestation_immutable" },
    });
    for (const change of [
      { mediaHashes: [] },
      { mediaHashes: ["ZZ".repeat(32)] },
      { mediaHashes: ["14".repeat(32), "14".repeat(32)] },
      { ownerWallet: wallet },
      { reportedAt: new Date("2026-09-29T10:00:00.000Z") },
    ]) {
      await expect(
        db
          .insert(conditionReports)
          .values({ ...reportInput, id: randomUUID(), version: 2, ...change }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    }
    const draftId = randomUUID();
    await db
      .insert(conditionReports)
      .values({ ...reportInput, id: draftId, version: 2 });
    await db.delete(conditionReports).where(eq(conditionReports.id, draftId));
    for (const table of [artworkMetadataVersions, verifications, conditionReports]) {
      await expect(
        db
          .update(table)
          .set({ artworkId: "123e4567-e89b-42d3-a456-426614174000" })
          .where(eq(table.artworkId, artwork.id)),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: "artwork_attestation_identity" },
      });
    }
    await expect(
      db.insert(conditionReports).values({
        ...reportInput,
        id: randomUUID(),
        artworkId: "123e4567-e89b-42d3-a456-426614174000",
        version: 2,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect(
      (
        await db
          .select()
          .from(conditionReports)
          .where(eq(conditionReports.id, reportId))
      )[0]?.mediaHashes,
    ).toEqual(mediaHashes);
    expect(
      (await db.select().from(artworks).where(eq(artworks.id, artwork.id)))[0]?.kathaId,
    ).toBe(artwork.kathaId);
  } finally {
    await connection.close();
  }
}, 30_000);

it("serializes append-only manual custody and separates private fulfillment", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const second = createDatabase(url);
  const db = connection.db;
  const wallet = "Vote111111111111111111111111111111111111111";
  const occurredAt = new Date("2026-10-01T10:00:00.000Z");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "custody-artist",
        displayName: "Synthetic artist",
        biography: "Synthetic biography",
        region: "Patan",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork, other] = await db
      .insert(artworks)
      .values([
        {
          artistId: artist.id,
          category: "PAUBHA",
          title: "Custody test",
          creationYear: 2026,
        },
        {
          artistId: artist.id,
          category: "PAUBHA",
          title: "Other custody test",
          creationYear: 2026,
        },
      ])
      .returning();
    if (!artwork || !other) throw new Error("Artwork missing");
    const input = {
      artworkId: artwork.id,
      fromState: "UNKNOWN" as const,
      toState: "KATHA_HELD" as const,
      custodianWallet: wallet,
      recordedByWallet: wallet,
      evidenceHash: "15".repeat(32),
      occurredAt,
    };
    const [initial] = await db.insert(custodyEvents).values(input).returning();
    if (!initial) throw new Error("Custody missing");
    expect(initial.revision).toBe(1);
    await db
      .insert(custodyEvents)
      .values({ ...input, artworkId: other.id, toState: "COLLECTOR_HELD" });
    await expect(db.insert(custodyEvents).values(input)).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_previous_state" },
    });
    await expect(
      db
        .insert(custodyEvents)
        .values({ ...input, fromState: "KATHA_HELD", toState: "COLLECTOR_HELD" }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_transition_valid" },
    });
    await expect(
      db.insert(custodyEvents).values({
        ...input,
        fromState: "KATHA_HELD",
        toState: "IN_TRANSIT",
        revision: 10,
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_revision_allocated" },
    });
    const dispatch = {
      ...input,
      fromState: "KATHA_HELD" as const,
      toState: "IN_TRANSIT" as const,
    };
    const race = await Promise.allSettled([
      db.insert(custodyEvents).values(dispatch),
      second.db.insert(custodyEvents).values(dispatch),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failure = race.find((result) => result.status === "rejected");
    if (!failure || failure.status !== "rejected")
      throw new Error("Expected stale custody rejection");
    expect(failure.reason).toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_previous_state" },
    });
    const receive = {
      ...input,
      fromState: "IN_TRANSIT" as const,
      toState: "COLLECTOR_HELD" as const,
    };
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(custodyEvents).values(receive);
        throw new Error("Synthetic rollback");
      }),
    ).rejects.toThrow("Synthetic rollback");
    await db.insert(custodyEvents).values(receive);
    const history = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.artworkId, artwork.id))
      .orderBy(asc(custodyEvents.revision));
    expect(history.map((row) => row.revision)).toEqual([1, 2, 3]);
    expect(history.map((row) => row.toState)).toEqual([
      "KATHA_HELD",
      "IN_TRANSIT",
      "COLLECTOR_HELD",
    ]);
    await expect(
      db
        .update(custodyEvents)
        .set({ evidenceHash: "16".repeat(32) })
        .where(eq(custodyEvents.id, initial.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_immutable" },
    });
    await expect(
      db.delete(custodyEvents).where(eq(custodyEvents.id, initial.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_immutable" },
    });
    await expect(
      db.insert(custodyEvents).values({
        ...input,
        fromState: "COLLECTOR_HELD",
        toState: "IN_TRANSIT",
        occurredAt: new Date("2026-09-30T10:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "custody_events_history_order" },
    });
    await expect(
      db
        .insert(custodyEvents)
        .values({ ...input, artworkId: "123e4567-e89b-42d3-a456-426614174000" }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    const requestInput: NewFulfillmentRequestRecord = {
      artworkId: artwork.id,
      requesterWallet: wallet,
      kind: "DELIVERY",
      recipientName: "Synthetic Recipient",
      contactEmail: "synthetic@example.invalid",
      addressLines: ["Synthetic address only"],
      city: "Synthetic City",
      countryCode: "NP",
    };
    const [request] = await db
      .insert(fulfillmentRequests)
      .values(requestInput)
      .returning();
    if (!request) throw new Error("Request missing");
    expect(request.status).toBe("REQUESTED");
    // Private fields have no column or relation in the public custody timeline.
    expect(Object.keys(initial)).not.toContain("recipientName");
    expect(Object.keys(initial)).not.toContain("addressLines");
    expect(Object.keys(initial)).not.toContain("contactEmail");
    await expect(
      db
        .update(fulfillmentRequests)
        .set({ status: "RECEIVED", handledByWallet: wallet })
        .where(eq(fulfillmentRequests.id, request.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_transition" },
    });
    await expect(
      db
        .update(fulfillmentRequests)
        .set({ status: "APPROVED" })
        .where(eq(fulfillmentRequests.id, request.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_handler_valid" },
    });
    await db
      .update(fulfillmentRequests)
      .set({ status: "APPROVED", handledByWallet: wallet })
      .where(eq(fulfillmentRequests.id, request.id));
    await expect(
      db.delete(fulfillmentRequests).where(eq(fulfillmentRequests.id, request.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_active" },
    });
    await db
      .update(fulfillmentRequests)
      .set({
        status: "DISPATCHED",
        courier: "Synthetic courier",
        trackingReference: "SYNTHETIC-ONLY",
      })
      .where(eq(fulfillmentRequests.id, request.id));
    await expect(
      db
        .update(fulfillmentRequests)
        .set({ addressLines: ["Changed address"] })
        .where(eq(fulfillmentRequests.id, request.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_details_locked" },
    });
    await expect(
      db
        .update(fulfillmentRequests)
        .set({ status: "CANCELLED" })
        .where(eq(fulfillmentRequests.id, request.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_transition" },
    });
    await db
      .update(fulfillmentRequests)
      .set({ status: "RECEIVED" })
      .where(eq(fulfillmentRequests.id, request.id));
    expect(
      await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.artworkId, artwork.id)),
    ).toHaveLength(3);
    await db.delete(fulfillmentRequests).where(eq(fulfillmentRequests.id, request.id));
    const [returned] = await db
      .insert(fulfillmentRequests)
      .values({
        ...requestInput,
        kind: "RETURN_TO_KATHA",
        contactEmail: null,
        contactPhone: "+977 0000000000",
      })
      .returning();
    if (!returned) throw new Error("Return request missing");
    await db
      .update(fulfillmentRequests)
      .set({ status: "CANCELLED" })
      .where(eq(fulfillmentRequests.id, returned.id));
    await expect(
      db
        .update(fulfillmentRequests)
        .set({ status: "REQUESTED" })
        .where(eq(fulfillmentRequests.id, returned.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_transition" },
    });
    const invalid: {
      change: Partial<NewFulfillmentRequestRecord>;
      constraint: string;
    }[] = [
      {
        change: { recipientName: " " },
        constraint: "fulfillment_requests_recipient_nonblank",
      },
      {
        change: { contactEmail: null, contactPhone: null },
        constraint: "fulfillment_requests_contact_valid",
      },
      {
        change: { contactEmail: "malformed" },
        constraint: "fulfillment_requests_contact_valid",
      },
      {
        change: { addressLines: [] },
        constraint: "fulfillment_requests_address_valid",
      },
      {
        change: { addressLines: [" "] },
        constraint: "fulfillment_requests_address_valid",
      },
      {
        change: { countryCode: "np" },
        constraint: "fulfillment_requests_country_format",
      },
      {
        change: { requesterWallet: "bad-wallet" },
        constraint: "fulfillment_requests_requester_format",
      },
      {
        change: { status: "DISPATCHED", handledByWallet: wallet },
        constraint: "fulfillment_requests_transition",
      },
    ];
    for (const { change, constraint } of invalid) {
      await expect(
        db.insert(fulfillmentRequests).values({ ...requestInput, ...change }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint_name: constraint },
      });
    }
    await expect(
      db
        .insert(fulfillmentRequests)
        .values({ ...requestInput, artworkId: "123e4567-e89b-42d3-a456-426614174000" }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db
        .update(fulfillmentRequests)
        .set({ requesterWallet: "11111111111111111111111111111111" })
        .where(eq(fulfillmentRequests.id, returned.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "fulfillment_requests_identity" },
    });
    expect(
      (await db.select().from(artworks).where(eq(artworks.id, artwork.id)))[0]
        ?.artistId,
    ).toBe(artist.id);
  } finally {
    await connection.close();
    await second.close();
  }
}, 30_000);

it("persists immutable wallets, single-use challenges and revocable hashed sessions", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url) throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const second = createDatabase(url);
  const db = connection.db;
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const rejection = (constraint: string, code = "23514") => ({
    cause: { code, constraint_name: constraint },
  });
  try {
    const [wallet, other] = await db
      .insert(wallets)
      .values([
        { address: "Vote111111111111111111111111111111111111111" },
        { address: "11111111111111111111111111111111" },
      ])
      .returning();
    if (!wallet || !other) throw new Error("Wallet fixture missing");
    await expect(
      db.insert(wallets).values({ address: wallet.address }),
    ).rejects.toMatchObject(rejection("wallets_address_unique", "23505"));
    await expect(
      db.insert(wallets).values({ address: "invalid" }),
    ).rejects.toMatchObject(rejection("wallets_address_format"));
    await expect(
      db
        .update(wallets)
        .set({ address: other.address })
        .where(eq(wallets.id, wallet.id)),
    ).rejects.toMatchObject(rejection("wallets_identity_immutable"));
    const challengeInput = () => {
      const nonce = digest(randomUUID());
      const message = `Synthetic Katha challenge\nWallet: ${wallet.address}\nDomain: localhost:3000\nCluster: LOCALNET\nNonce: ${nonce}`;
      return {
        walletId: wallet.id,
        nonce,
        domain: "localhost:3000",
        cluster: "LOCALNET" as const,
        message,
        messageHash: digest(message),
        issuedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 600_000),
      };
    };
    const input = challengeInput();
    const [challenge] = await db.insert(walletChallenges).values(input).returning();
    if (!challenge) throw new Error("Challenge missing");
    await expect(db.insert(walletChallenges).values(input)).rejects.toMatchObject(
      rejection("wallet_challenges_nonce_unique", "23505"),
    );
    const invalid = [
      {
        change: { nonce: "x".repeat(64) },
        constraint: "wallet_challenges_nonce_format",
      },
      {
        change: { domain: "https://localhost" },
        constraint: "wallet_challenges_domain_format",
      },
      {
        change: { messageHash: "0".repeat(64) },
        constraint: "wallet_challenges_message_integrity",
      },
      { change: { message: "" }, constraint: "wallet_challenges_message_integrity" },
      {
        change: { expiresAt: new Date(0) },
        constraint: "wallet_challenges_time_order",
      },
      {
        change: { consumedAt: new Date() },
        constraint: "wallet_challenges_unused_insert",
      },
    ];
    for (const { change, constraint } of invalid) {
      await expect(
        db.insert(walletChallenges).values({ ...challengeInput(), ...change }),
      ).rejects.toMatchObject(rejection(constraint));
    }
    await expect(
      db
        .insert(walletChallenges)
        .values({ ...challengeInput(), walletId: randomUUID() }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const sessionInput = (challengeId: string, token = randomUUID()) => ({
      walletId: wallet.id,
      challengeId,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await expect(
      db.insert(walletSessions).values(sessionInput(challenge.id)),
    ).rejects.toMatchObject(rejection("wallet_sessions_challenge_valid"));
    await expect(
      db
        .insert(walletSessions)
        .values({ ...sessionInput(challenge.id), walletId: other.id }),
    ).rejects.toMatchObject(rejection("wallet_sessions_challenge_wallet_fk", "23503"));
    await expect(
      db
        .update(walletChallenges)
        .set({ message: "changed" })
        .where(eq(walletChallenges.id, challenge.id)),
    ).rejects.toMatchObject(rejection("wallet_challenges_immutable"));
    for (const offset of [-120_000, 120_000]) {
      const [timed] = await db
        .insert(walletChallenges)
        .values({
          ...challengeInput(),
          issuedAt: new Date(Date.now() + offset),
          expiresAt: new Date(Date.now() + offset + 60_000),
        })
        .returning();
      if (!timed) throw new Error("Timed challenge missing");
      await expect(
        db
          .update(walletChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(walletChallenges.id, timed.id)),
      ).rejects.toMatchObject(rejection("wallet_challenges_expired"));
    }
    // Separate pools compete for the same challenge; row locking permits only one issuance.
    const results = await Promise.allSettled(
      [db, second.db].map((pool) =>
        pool.transaction(async (tx) => {
          await tx
            .update(walletChallenges)
            .set({ consumedAt: new Date() })
            .where(eq(walletChallenges.id, challenge.id));
          return tx
            .insert(walletSessions)
            .values(sessionInput(challenge.id))
            .returning();
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status !== "rejected")
      throw new Error("Expected competing issuance rejection");
    expect(failed.reason).toMatchObject(rejection("wallet_challenges_single_use"));
    const [session] = await db
      .select()
      .from(walletSessions)
      .where(eq(walletSessions.challengeId, challenge.id));
    if (!session) throw new Error("Session missing");
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      (
        await db
          .select()
          .from(walletChallenges)
          .where(eq(walletChallenges.id, challenge.id))
      )[0]?.consumedAt,
    ).toBeInstanceOf(Date);
    await expect(
      db
        .update(walletChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(walletChallenges.id, challenge.id)),
    ).rejects.toMatchObject(rejection("wallet_challenges_single_use"));
    await expect(
      db.insert(walletSessions).values(sessionInput(challenge.id)),
    ).rejects.toMatchObject(rejection("wallet_sessions_challenge_unique", "23505"));
    await expect(
      db
        .insert(walletSessions)
        .values({ ...sessionInput(challenge.id), tokenHash: "bad" }),
    ).rejects.toMatchObject(rejection("wallet_sessions_token_hash_format"));
    await expect(
      db
        .insert(walletSessions)
        .values({ ...sessionInput(challenge.id), expiresAt: new Date(0) }),
    ).rejects.toMatchObject(rejection("wallet_sessions_expiry_valid"));
    await expect(
      db
        .insert(walletSessions)
        .values({ ...sessionInput(challenge.id), revokedAt: new Date() }),
    ).rejects.toMatchObject(rejection("wallet_sessions_unrevoked_insert"));
    await expect(
      db
        .update(walletSessions)
        .set({ expiresAt: new Date(Date.now() + 7_200_000) })
        .where(eq(walletSessions.id, session.id)),
    ).rejects.toMatchObject(rejection("wallet_sessions_immutable"));
    const [retry] = await db
      .insert(walletChallenges)
      .values(challengeInput())
      .returning();
    if (!retry) throw new Error("Retry challenge missing");
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(walletChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(walletChallenges.id, retry.id));
        await tx.insert(walletSessions).values(sessionInput(retry.id));
        throw new Error("Synthetic issuance rollback");
      }),
    ).rejects.toThrow("Synthetic issuance rollback");
    expect(
      (
        await db
          .select()
          .from(walletChallenges)
          .where(eq(walletChallenges.id, retry.id))
      )[0]?.consumedAt,
    ).toBeNull();
    expect(
      await db
        .select()
        .from(walletSessions)
        .where(eq(walletSessions.challengeId, retry.id)),
    ).toHaveLength(0);
    await db
      .update(walletChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(walletChallenges.id, retry.id));
    await expect(
      db
        .insert(walletSessions)
        .values({ ...sessionInput(retry.id), tokenHash: session.tokenHash }),
    ).rejects.toMatchObject(rejection("wallet_sessions_token_hash_unique", "23505"));
    await db.insert(walletSessions).values(sessionInput(retry.id));
    await db
      .update(walletSessions)
      .set({ revokedAt: new Date() })
      .where(eq(walletSessions.id, session.id));
    for (const revokedAt of [null, new Date()]) {
      await expect(
        db
          .update(walletSessions)
          .set({ revokedAt })
          .where(eq(walletSessions.id, session.id)),
      ).rejects.toMatchObject(rejection("wallet_sessions_revocation_once"));
    }
    const active = await db
      .select()
      .from(walletSessions)
      .where(
        and(
          eq(walletSessions.walletId, wallet.id),
          sql`${walletSessions.revokedAt} IS NULL`,
          sql`${walletSessions.expiresAt} > clock_timestamp()`,
        ),
      );
    expect(active).toHaveLength(1);
    await db.delete(walletChallenges).where(eq(walletChallenges.id, retry.id));
    expect(
      await db
        .select()
        .from(walletSessions)
        .where(eq(walletSessions.challengeId, retry.id)),
    ).toHaveLength(0);
    await db.delete(wallets).where(eq(wallets.id, wallet.id));
    expect(
      await db
        .select()
        .from(walletChallenges)
        .where(eq(walletChallenges.walletId, wallet.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(walletSessions)
        .where(eq(walletSessions.walletId, wallet.id)),
    ).toHaveLength(0);
  } finally {
    await connection.close();
    await second.close();
  }
}, 30_000);

it("preserves idempotent operation expectations and reconciles immutable transaction attempts", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const second = createDatabase(url);
  const db = connection.db;
  const rejection = (constraint: string, code = "23514") => ({
    cause: { code, constraint_name: constraint },
  });
  const address = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "operation-artist",
        displayName: "Synthetic Artist",
        biography: "Synthetic biography",
        region: "Lalitpur",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic operations",
        creationYear: 2026,
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Operation fixtures missing");
    const input: NewBlockchainOperationRecord = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET",
      kind: "REGISTER_ARTWORK",
      idempotencyKey: "synthetic-register-1",
      requestHash: "a".repeat(64),
      programAddress: address,
      expectedAccounts: [address, "11111111111111111111111111111111"],
      expectedHashes: ["b".repeat(64)],
    };
    const race = await Promise.allSettled(
      [db, second.db].map((pool) =>
        pool.insert(blockchainOperations).values(input).returning(),
      ),
    );
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = race.find((result) => result.status === "rejected");
    if (failed?.status !== "rejected")
      throw new Error("Expected duplicate key rejection");
    expect(failed.reason).toMatchObject(
      rejection("blockchain_operations_idempotency_unique", "23505"),
    );
    const [operation] = await db
      .select()
      .from(blockchainOperations)
      .where(eq(blockchainOperations.idempotencyKey, input.idempotencyKey));
    if (!operation) throw new Error("Operation missing");
    const operationStatus = async () =>
      (
        await db
          .select()
          .from(blockchainOperations)
          .where(eq(blockchainOperations.id, operation.id))
      )[0]?.status;
    expect(await operationStatus()).toBe("PREPARED");
    await expect(
      db.insert(blockchainOperations).values({ ...input, requestHash: "c".repeat(64) }),
    ).rejects.toMatchObject(
      rejection("blockchain_operations_idempotency_unique", "23505"),
    );
    await db.insert(blockchainOperations).values({ ...input, cluster: "DEVNET" });
    const invalid: {
      change: Partial<NewBlockchainOperationRecord>;
      constraint: string;
    }[] = [
      {
        change: { idempotencyKey: "with space" },
        constraint: "blockchain_operations_key_format",
      },
      {
        change: { requestHash: "bad" },
        constraint: "blockchain_operations_request_hash_format",
      },
      {
        change: { programAddress: "bad" },
        constraint: "blockchain_operations_program_format",
      },
      {
        change: { expectedAccounts: [] },
        constraint: "blockchain_operations_accounts_valid",
      },
      {
        change: { expectedAccounts: ["bad"] },
        constraint: "blockchain_operations_accounts_valid",
      },
      {
        change: { expectedHashes: ["bad"] },
        constraint: "blockchain_operations_hashes_valid",
      },
    ];
    for (const { change, constraint } of invalid) {
      await expect(
        db
          .insert(blockchainOperations)
          .values({ ...input, idempotencyKey: randomUUID(), ...change }),
      ).rejects.toMatchObject(rejection(constraint));
    }
    for (const change of [{ walletId: randomUUID() }, { artworkId: randomUUID() }]) {
      await expect(
        db
          .insert(blockchainOperations)
          .values({ ...input, idempotencyKey: randomUUID(), ...change }),
      ).rejects.toMatchObject({ cause: { code: "23503" } });
    }
    await expect(
      db
        .insert(blockchainOperations)
        .values({ ...input, idempotencyKey: randomUUID(), status: "FINALIZED" }),
    ).rejects.toMatchObject(rejection("blockchain_operations_prepared_insert"));
    await expect(
      db
        .update(blockchainOperations)
        .set({ requestHash: "c".repeat(64) })
        .where(eq(blockchainOperations.id, operation.id)),
    ).rejects.toMatchObject(rejection("blockchain_operations_immutable"));
    await expect(
      db
        .update(blockchainOperations)
        .set({ status: "FINALIZED" })
        .where(eq(blockchainOperations.id, operation.id)),
    ).rejects.toMatchObject(rejection("blockchain_operations_receipt_status"));
    const attemptInput = (character: string) => ({
      operationId: operation.id,
      cluster: "LOCALNET" as const,
      signature: character.repeat(64),
      messageHash: "d".repeat(64),
    });
    await expect(
      db
        .insert(transactionReceipts)
        .values({ ...attemptInput("2"), cluster: "DEVNET" }),
    ).rejects.toMatchObject(
      rejection("transaction_receipts_operation_cluster_fk", "23503"),
    );
    await expect(
      db
        .insert(transactionReceipts)
        .values({ ...attemptInput("2"), operationId: randomUUID() }),
    ).rejects.toMatchObject(
      rejection("transaction_receipts_operation_cluster_fk", "23503"),
    );
    await expect(
      db
        .insert(transactionReceipts)
        .values({ ...attemptInput("2"), status: "FINALIZED" }),
    ).rejects.toMatchObject(rejection("transaction_receipts_unknown_insert"));
    await expect(
      db.insert(transactionReceipts).values({ ...attemptInput("2"), signature: "bad" }),
    ).rejects.toMatchObject(rejection("transaction_receipts_signature_format"));
    await expect(
      db
        .insert(transactionReceipts)
        .values({ ...attemptInput("2"), messageHash: "bad" }),
    ).rejects.toMatchObject(rejection("transaction_receipts_message_hash_format"));
    const [attempt] = await db
      .insert(transactionReceipts)
      .values(attemptInput("2"))
      .returning();
    if (!attempt) throw new Error("Attempt missing");
    expect(await operationStatus()).toBe("UNKNOWN");
    await expect(
      db.insert(transactionReceipts).values(attemptInput("2")),
    ).rejects.toMatchObject(
      rejection("transaction_receipts_signature_unique", "23505"),
    );
    await expect(
      db
        .update(transactionReceipts)
        .set({ signature: "3".repeat(64) })
        .where(eq(transactionReceipts.id, attempt.id)),
    ).rejects.toMatchObject(rejection("transaction_receipts_immutable"));
    await expect(
      db
        .update(transactionReceipts)
        .set({ status: "FAILED" })
        .where(eq(transactionReceipts.id, attempt.id)),
    ).rejects.toMatchObject(rejection("transaction_receipts_outcome_complete"));
    await db
      .update(transactionReceipts)
      .set({ status: "FAILED", failureCode: "TRANSACTION_ERROR" })
      .where(eq(transactionReceipts.id, attempt.id));
    expect(await operationStatus()).toBe("FAILED");
    await expect(
      db
        .update(transactionReceipts)
        .set({ status: "UNKNOWN", failureCode: null })
        .where(eq(transactionReceipts.id, attempt.id)),
    ).rejects.toMatchObject(rejection("transaction_receipts_terminal"));
    // A new signed attempt retains the failed receipt; timeout uncertainty never means failure.
    const attempts = await db
      .insert(transactionReceipts)
      .values([attemptInput("3"), attemptInput("4")])
      .returning();
    expect(await operationStatus()).toBe("UNKNOWN");
    const outcome = {
      status: "FINALIZED" as const,
      slot: 9007199254740993n,
      chainRecordedAt: new Date(Date.now() - 2000),
      finalizedAt: new Date(Date.now() - 1000),
    };
    const firstAttempt = attempts[0];
    if (!firstAttempt) throw new Error("Retry missing");
    await expect(
      db
        .update(transactionReceipts)
        .set({ status: "FINALIZED" })
        .where(eq(transactionReceipts.id, firstAttempt.id)),
    ).rejects.toMatchObject(rejection("transaction_receipts_outcome_complete"));
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(transactionReceipts)
          .set(outcome)
          .where(eq(transactionReceipts.id, firstAttempt.id));
        throw new Error("Synthetic reconciliation rollback");
      }),
    ).rejects.toThrow("Synthetic reconciliation rollback");
    expect(await operationStatus()).toBe("UNKNOWN");
    const outcomes = await Promise.allSettled(
      attempts.map((receipt, i) =>
        (i ? second.db : db)
          .update(transactionReceipts)
          .set(outcome)
          .where(eq(transactionReceipts.id, receipt.id))
          .returning(),
      ),
    );
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === "rejected");
    if (rejected?.status !== "rejected")
      throw new Error("Expected second success rejection");
    expect(rejected.reason).toMatchObject(
      rejection("transaction_receipts_one_success"),
    );
    expect(await operationStatus()).toBe("FINALIZED");
    const receipts = await db
      .select()
      .from(transactionReceipts)
      .where(eq(transactionReceipts.operationId, operation.id));
    expect(receipts).toHaveLength(3);
    const success = receipts.find((receipt) => receipt.status === "FINALIZED");
    const pending = receipts.find((receipt) => receipt.status === "UNKNOWN");
    if (!success || !pending) throw new Error("Reconciliation records missing");
    expect(success.slot).toBe(9007199254740993n);
    await expect(
      db
        .update(transactionReceipts)
        .set({ ...outcome, slot: 1n })
        .where(eq(transactionReceipts.id, success.id)),
    ).rejects.toMatchObject(rejection("transaction_receipts_terminal"));
    await db
      .update(transactionReceipts)
      .set({ status: "FAILED", failureCode: "EXPIRED_BLOCKHASH" })
      .where(eq(transactionReceipts.id, pending.id));
    expect(await operationStatus()).toBe("FINALIZED");
    await expect(
      db.insert(transactionReceipts).values(attemptInput("5")),
    ).rejects.toMatchObject(rejection("transaction_receipts_unknown_insert"));
    await expect(
      db.delete(transactionReceipts).where(eq(transactionReceipts.id, attempt.id)),
    ).rejects.toMatchObject(rejection("transaction_receipts_permanent"));
    await expect(
      db.delete(blockchainOperations).where(eq(blockchainOperations.id, operation.id)),
    ).rejects.toMatchObject(rejection("blockchain_operations_permanent"));
    await expect(
      db.delete(wallets).where(eq(wallets.id, wallet.id)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    // Persistence never manufactures verification or ownership history from receipt status.
    expect(
      await db
        .select()
        .from(verifications)
        .where(eq(verifications.artworkId, artwork.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.artworkId, artwork.id)),
    ).toHaveLength(0);
  } finally {
    await connection.close();
    await second.close();
  }
}, 30_000);

it("deduplicates indexed events and guards checkpoints, ownership, listings and sale projections", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const second = createDatabase(url);
  const db = connection.db;
  const address = "Vote111111111111111111111111111111111111111";
  const buyer = "11111111111111111111111111111111";
  const rejection = (constraint: string, code = "23514") => ({
    cause: { code, constraint_name: constraint },
  });
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "index-artist",
        displayName: "Synthetic Artist",
        biography: "Synthetic biography",
        region: "Lalitpur",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic indexed artwork",
        creationYear: 2026,
      })
      .returning();
    if (!artwork) throw new Error("Artwork missing");
    const eventInput = (
      signature: string,
      slot: bigint,
      payload: Record<string, unknown>,
      kind: NewIndexedEventRecord["kind"] = "OWNERSHIP",
    ): NewIndexedEventRecord => ({
      cluster: "LOCALNET",
      programAddress: address,
      signature: signature.repeat(64),
      slot,
      transactionIndex: 0,
      outerInstructionIndex: 0,
      kind,
      artworkId: artwork.id,
      assetAddress: address,
      payload,
      chainRecordedAt: new Date(Date.now() - 60_000),
    });
    const sourceInput = eventInput("6", 100n, { ownerWallet: address });
    const race = await Promise.allSettled(
      [db, second.db].map((pool) =>
        pool.insert(indexedEvents).values(sourceInput).returning(),
      ),
    );
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = race.find((r) => r.status === "rejected");
    if (failed?.status !== "rejected")
      throw new Error("Expected event duplicate rejection");
    expect(failed.reason).toMatchObject(
      rejection("indexed_events_identity_unique", "23505"),
    );
    const [source] = await db
      .select()
      .from(indexedEvents)
      .where(eq(indexedEvents.signature, sourceInput.signature));
    if (!source) throw new Error("Source event missing");
    // Same signature can contain multiple CPI instructions and decoded events.
    await db.insert(indexedEvents).values([
      { ...sourceInput, innerInstructionIndex: 0 },
      { ...sourceInput, eventIndex: 1 },
      { ...sourceInput, cluster: "DEVNET" },
    ]);
    await expect(
      db
        .update(indexedEvents)
        .set({ slot: 101n })
        .where(eq(indexedEvents.id, source.id)),
    ).rejects.toMatchObject(rejection("indexed_events_immutable"));
    await expect(
      db.delete(indexedEvents).where(eq(indexedEvents.id, source.id)),
    ).rejects.toMatchObject(rejection("indexed_events_immutable"));
    const invalid: { change: Partial<NewIndexedEventRecord>; constraint: string }[] = [
      { change: { slot: -1n }, constraint: "indexed_events_position_valid" },
      {
        change: { innerInstructionIndex: -2 },
        constraint: "indexed_events_position_valid",
      },
      { change: { signature: "bad" }, constraint: "indexed_events_signature_valid" },
      {
        change: { programAddress: "bad" },
        constraint: "indexed_events_addresses_valid",
      },
      { change: { assetAddress: null }, constraint: "indexed_events_scope_valid" },
      {
        change: { payload: { text: "x".repeat(65536) } },
        constraint: "indexed_events_payload_valid",
      },
    ];
    for (const { change, constraint } of invalid) {
      await expect(
        db.insert(indexedEvents).values({ ...eventInput("7", 102n, {}), ...change }),
      ).rejects.toMatchObject(rejection(constraint));
    }
    const ownerInput = {
      cluster: "LOCALNET" as const,
      artworkId: artwork.id,
      assetAddress: address,
      ownerWallet: address,
      sourceEventId: source.id,
    };
    await db.insert(artworkOwnership).values(ownerInput);
    await expect(
      db.insert(artworkOwnership).values({ ...ownerInput, cluster: "DEVNET" }),
    ).rejects.toMatchObject(rejection("chain_projections_event_scope"));
    await expect(
      db
        .update(artworkOwnership)
        .set({ ownerWallet: buyer })
        .where(eq(artworkOwnership.artworkId, artwork.id)),
    ).rejects.toMatchObject(rejection("chain_projections_owner_binding"));
    const [nextOwner] = await db
      .insert(indexedEvents)
      .values(eventInput("7", 103n, { ownerWallet: buyer }))
      .returning();
    if (!nextOwner) throw new Error("New owner event missing");
    await db
      .update(artworkOwnership)
      .set({ ownerWallet: buyer, sourceEventId: nextOwner.id })
      .where(eq(artworkOwnership.artworkId, artwork.id));
    await expect(
      db
        .update(artworkOwnership)
        .set({ ownerWallet: address, sourceEventId: source.id })
        .where(eq(artworkOwnership.artworkId, artwork.id)),
    ).rejects.toMatchObject(rejection("chain_projections_stale_event"));
    const checkpoint = {
      cluster: "LOCALNET" as const,
      programAddress: address,
      fromSlot: 0n,
      scannedThroughSlot: 103n,
      lastSignature: nextOwner.signature,
      lastSignatureSlot: 103n,
    };
    await db.insert(indexerCheckpoints).values(checkpoint);
    await expect(
      db
        .update(indexerCheckpoints)
        .set({ scannedThroughSlot: 102n })
        .where(eq(indexerCheckpoints.programAddress, address)),
    ).rejects.toMatchObject(rejection("indexer_checkpoints_monotonic"));
    await expect(
      db
        .update(indexerCheckpoints)
        .set({ fromSlot: 1n })
        .where(eq(indexerCheckpoints.programAddress, address)),
    ).rejects.toMatchObject(rejection("indexer_checkpoints_identity"));
    await expect(
      db
        .update(indexerCheckpoints)
        .set({ gapFromSlot: 110n })
        .where(eq(indexerCheckpoints.programAddress, address)),
    ).rejects.toMatchObject(rejection("indexer_checkpoints_gap_valid"));
    await db
      .update(indexerCheckpoints)
      .set({ gapFromSlot: 104n, gapThroughSlot: 110n })
      .where(eq(indexerCheckpoints.programAddress, address));
    const expiresAt = new Date(Date.now() + 60_000);
    const listingPayload = {
      listingAddress: address,
      sellerWallet: buyer,
      paymentMint: address,
      price: "18446744073709551615",
      status: "ACTIVE",
      expiresAt: expiresAt.toISOString(),
    };
    const [listingEvent] = await db
      .insert(indexedEvents)
      .values(eventInput("8", 104n, listingPayload, "LISTING"))
      .returning();
    if (!listingEvent) throw new Error("Listing event missing");
    const listingInput = {
      cluster: "LOCALNET" as const,
      artworkId: artwork.id,
      assetAddress: address,
      sourceEventId: listingEvent.id,
      listingAddress: address,
      sellerWallet: buyer,
      paymentMint: address,
      price: 18446744073709551615n,
      status: "ACTIVE" as const,
      expiresAt,
    };
    const [listing] = await db.insert(artworkListings).values(listingInput).returning();
    if (!listing) throw new Error("Listing missing");
    expect(listing.price).toBe(18446744073709551615n);
    await expect(db.insert(artworkListings).values(listingInput)).rejects.toMatchObject(
      { cause: { code: "23505" } },
    );
    await expect(
      db.insert(artworkListings).values({ ...listingInput, price: 1n }),
    ).rejects.toMatchObject(rejection("chain_projections_listing_binding"));
    // Numeric storage rejects fractional base units instead of rounding them.
    const [fractionEvent] = await db
      .insert(indexedEvents)
      .values(eventInput("9", 105n, { ...listingPayload, price: "1.5" }, "LISTING"))
      .returning();
    if (!fractionEvent) throw new Error("Fractional fixture missing");
    await expect(
      db.execute(
        sql`insert into artwork_listings (cluster, artwork_id, asset_address, source_event_id, listing_address, seller_wallet, payment_mint, price, status, expires_at) values ('LOCALNET', ${artwork.id}, ${address}, ${fractionEvent.id}, ${address}, ${buyer}, ${address}, 1.5, 'ACTIVE', ${expiresAt.toISOString()}::timestamptz)`,
      ),
    ).rejects.toMatchObject(rejection("artwork_listings_price_valid"));
    const [competingListingEvent] = await db
      .insert(indexedEvents)
      .values(
        eventInput("D", 105n, { ...listingPayload, listingAddress: buyer }, "LISTING"),
      )
      .returning();
    if (!competingListingEvent) throw new Error("Competing listing fixture missing");
    await expect(
      db.insert(artworkListings).values({
        ...listingInput,
        listingAddress: buyer,
        sourceEventId: competingListingEvent.id,
      }),
    ).rejects.toMatchObject(rejection("artwork_listings_active_unique", "23505"));
    const [overflowEvent] = await db
      .insert(indexedEvents)
      .values(
        eventInput(
          "E",
          105n,
          { ...listingPayload, price: "18446744073709551616" },
          "LISTING",
        ),
      )
      .returning();
    if (!overflowEvent) throw new Error("Overflow fixture missing");
    await expect(
      db.insert(artworkListings).values({
        ...listingInput,
        price: 18446744073709551616n,
        sourceEventId: overflowEvent.id,
      }),
    ).rejects.toMatchObject(rejection("artwork_listings_price_valid"));
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(indexedEvents).values(eventInput("F", 105n, {}, "REGISTRY"));
        await tx
          .update(indexerCheckpoints)
          .set({ scannedThroughSlot: 105n })
          .where(eq(indexerCheckpoints.programAddress, address));
        throw new Error("Synthetic event checkpoint rollback");
      }),
    ).rejects.toThrow("Synthetic event checkpoint rollback");
    expect(
      await db
        .select()
        .from(indexedEvents)
        .where(eq(indexedEvents.signature, "F".repeat(64))),
    ).toHaveLength(0);
    const salePayload = {
      ...listingPayload,
      status: "PURCHASED",
      buyerWallet: address,
      isPrimary: false,
      proceedsWallet: buyer,
      proceedsAmount: "18446744073709551615",
      artistWallet: address,
      royaltyAmount: "0",
      treasuryWallet: address,
      platformFee: "0",
    };
    const [saleEvent] = await db
      .insert(indexedEvents)
      .values(eventInput("A", 106n, salePayload, "SALE"))
      .returning();
    if (!saleEvent) throw new Error("Sale event missing");
    const saleInput = {
      cluster: "LOCALNET" as const,
      artworkId: artwork.id,
      assetAddress: address,
      sourceEventId: saleEvent.id,
      listingId: listing.id,
      buyerWallet: address,
      sellerWallet: buyer,
      paymentMint: address,
      price: listing.price,
      isPrimary: false,
      proceedsWallet: buyer,
      proceedsAmount: listing.price,
      artistWallet: address,
      royaltyAmount: 0n,
      treasuryWallet: address,
      platformFee: 0n,
    };
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(artworkSales).values(saleInput);
        await tx
          .update(artworkListings)
          .set({ status: "PURCHASED", sourceEventId: saleEvent.id })
          .where(eq(artworkListings.id, listing.id));
        await tx
          .update(indexerCheckpoints)
          .set({ scannedThroughSlot: 106n })
          .where(eq(indexerCheckpoints.programAddress, address));
        throw new Error("Synthetic index batch rollback");
      }),
    ).rejects.toThrow("Synthetic index batch rollback");
    expect(
      await db
        .select()
        .from(artworkSales)
        .where(eq(artworkSales.listingId, listing.id)),
    ).toHaveLength(0);
    expect(
      (
        await db
          .select()
          .from(artworkListings)
          .where(eq(artworkListings.id, listing.id))
      )[0]?.status,
    ).toBe("ACTIVE");
    expect((await db.select().from(indexerCheckpoints))[0]?.scannedThroughSlot).toBe(
      103n,
    );
    await db.transaction(async (tx) => {
      await tx.insert(artworkSales).values(saleInput);
      await tx
        .update(artworkListings)
        .set({ status: "PURCHASED", sourceEventId: saleEvent.id })
        .where(eq(artworkListings.id, listing.id));
      await tx
        .update(artworkOwnership)
        .set({ ownerWallet: address, sourceEventId: saleEvent.id })
        .where(eq(artworkOwnership.artworkId, artwork.id));
      await tx
        .update(indexerCheckpoints)
        .set({ scannedThroughSlot: 106n, gapFromSlot: null, gapThroughSlot: null })
        .where(eq(indexerCheckpoints.programAddress, address));
    });
    await expect(db.insert(artworkSales).values(saleInput)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
    await expect(
      db.update(artworkSales).set({ buyerWallet: buyer }),
    ).rejects.toMatchObject(rejection("chain_projections_sale_immutable"));
    await expect(
      db.insert(artworkSales).values({ ...saleInput, paymentMint: buyer }),
    ).rejects.toMatchObject(rejection("chain_projections_sale_listing"));
    await expect(
      db.insert(artworkSales).values({ ...saleInput, platformFee: 1n }),
    ).rejects.toMatchObject(rejection("chain_projections_sale_binding"));
    // Check sum and primary-recipient constraints using a decoded event with matching invalid fields.
    const [invalidSaleEvent] = await db
      .insert(indexedEvents)
      .values(
        eventInput(
          "B",
          107n,
          { ...salePayload, proceedsAmount: "18446744073709551614" },
          "SALE",
        ),
      )
      .returning();
    if (!invalidSaleEvent) throw new Error("Invalid sale fixture missing");
    await expect(
      db.insert(artworkSales).values({
        ...saleInput,
        sourceEventId: invalidSaleEvent.id,
        proceedsAmount: listing.price - 1n,
      }),
    ).rejects.toMatchObject(rejection("artwork_sales_amounts_valid"));
    const [invalidPrimaryEvent] = await db
      .insert(indexedEvents)
      .values(eventInput("G", 107n, { ...salePayload, isPrimary: true }, "SALE"))
      .returning();
    if (!invalidPrimaryEvent) throw new Error("Primary recipient fixture missing");
    await expect(
      db.insert(artworkSales).values({
        ...saleInput,
        sourceEventId: invalidPrimaryEvent.id,
        isPrimary: true,
      }),
    ).rejects.toMatchObject(rejection("artwork_sales_recipient_scope"));
    const [reopenEvent] = await db
      .insert(indexedEvents)
      .values(eventInput("C", 108n, listingPayload, "LISTING"))
      .returning();
    if (!reopenEvent) throw new Error("Reopen fixture missing");
    await expect(
      db
        .update(artworkListings)
        .set({ status: "ACTIVE", sourceEventId: reopenEvent.id })
        .where(eq(artworkListings.id, listing.id)),
    ).rejects.toMatchObject(rejection("chain_projections_listing_transition"));
    expect(
      (
        await db
          .select()
          .from(artworkOwnership)
          .where(eq(artworkOwnership.artworkId, artwork.id))
      )[0]?.ownerWallet,
    ).toBe(address);
    expect(
      await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.artworkId, artwork.id)),
    ).toHaveLength(0);
    expect(
      (await db.select().from(artworks).where(eq(artworks.id, artwork.id)))[0]
        ?.artistId,
    ).toBe(artist.id);
  } finally {
    await connection.close();
    await second.close();
  }
}, 30_000);

it("atomically retains immutable operation intents and refreshed unsigned preparations under concurrent retries", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const other = createDatabase(url);
  const {
    createOperationPreparationStore,
    operationPreparations,
    blockchainOperations,
    wallets,
    transactionReceipts,
  } = await import("../src/index.js");
  const address = "9".repeat(32); // Synthetic persistence-only wallet; never signs.
  const canonicalRequest = '{"synthetic":"operation preparation"}';
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const db = connection.db;
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "preparation-artist",
        displayName: "Synthetic Artist",
        biography: "Synthetic biography",
        region: "Lalitpur",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic preparation",
        creationYear: 2026,
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixtures missing");
    const input = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "REGISTER_ARTWORK" as const,
      idempotencyKey: "preparation-race",
      requestHash: digest(canonicalRequest),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 20n,
      simulationUnits: 30n,
    };
    const stores = [
      createOperationPreparationStore(db),
      createOperationPreparationStore(other.db),
    ];
    const results = await Promise.all(
      stores.map((store) => store.save(input, address, artwork.kathaId, preparation)),
    );
    expect(results[0]).toEqual(results[1]);
    const result = results[0]!;
    if (result.status !== "saved") throw new Error("Save failed");
    const count = async () =>
      db
        .select()
        .from(operationPreparations)
        .where(eq(operationPreparations.operationId, result.operationId));
    expect(await count()).toHaveLength(1);
    const refreshed = await stores[0]!.save(input, address, artwork.kathaId, {
      ...preparation,
      messageHash: "b".repeat(64),
      transactionBase64: "AAAB",
      blockhash: address,
      lastValidBlockHeight: 110n,
    });
    expect(refreshed.status).toBe("saved");
    expect(await count()).toHaveLength(2);
    const collision = await stores[0]!.save(
      { ...input, requestHash: "c".repeat(64) },
      address,
      artwork.kathaId,
      preparation,
    );
    expect(collision.status).toBe("conflict");
    expect(
      (await stores[0]!.save(input, "8".repeat(32), artwork.kathaId, preparation))
        .status,
    ).toBe("conflict");
    expect(
      (await stores[0]!.save(input, address, "KATHA-PAUBHA-999999", preparation))
        .status,
    ).toBe("not_found");
    expect(
      (
        await stores[0]!.save(input, address, artwork.kathaId, {
          ...preparation,
          transactionBase64: "AAAC",
        })
      ).status,
    ).toBe("conflict");
    await expect(
      db
        .update(operationPreparations)
        .set({ transactionBase64: "AAAD" })
        .where(eq(operationPreparations.id, result.preparationId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "operation_preparations_permanent" },
    });
    await expect(
      db
        .delete(operationPreparations)
        .where(eq(operationPreparations.id, result.preparationId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "operation_preparations_permanent" },
    });
    const rollbackInput = { ...input, idempotencyKey: "preparation-rollback" };
    await expect(
      stores[0]!.save(rollbackInput, address, artwork.kathaId, {
        ...preparation,
        canonicalRequest: '{"tampered":true}',
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "operation_preparations_intent_match" },
    });
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, rollbackInput.idempotencyKey)),
    ).toHaveLength(0);
    await db.insert(transactionReceipts).values({
      operationId: result.operationId,
      cluster: "LOCALNET",
      signature: "6".repeat(88),
      messageHash: preparation.messageHash,
    });
    expect(
      (await stores[0]!.save(input, address, artwork.kathaId, preparation)).status,
    ).toBe("conflict");
    expect(await count()).toHaveLength(2);
  } finally {
    await Promise.all([connection.close(), other.close()]);
  }
});

it("rechecks registration snapshots under save locks and rolls back raced eligibility changes", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const {
    createArtworkRegistrationStore,
    artworkMetadataVersions,
    wallets,
    blockchainOperations,
  } = await import("../src/index.js");
  const address = "7".repeat(32);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "registration-guard-artist",
        displayName: "Synthetic Artist",
        biography: "Private test biography",
        region: "Bagmati",
        traditions: ["Paubha"],
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: new Date("2026-10-05T00:00:00.000Z"),
        createdAt: new Date("2026-10-05T00:00:00.000Z"),
        updatedAt: new Date("2026-10-05T00:00:00.000Z"),
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic guarded registration",
        creationYear: 2026,
        authorshipEvidenceHash: "e".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixtures missing");
    const document = JSON.stringify({
      kathaId: artwork.kathaId,
      synthetic: "registration metadata",
    });
    const metadataValues = {
      artworkId: artwork.id,
      version: 1,
      status: "PREPARED" as const,
      authorityWallet: address,
      canonicalDocument: document,
      documentHash: hash(document),
      uri: "http://localhost:3001/synthetic.json",
    };
    await db.insert(artworkMetadataVersions).values(metadataValues);
    const store = createArtworkRegistrationStore(db, "LOCALNET");
    const before = await store.load(artwork.kathaId);
    if (!before) throw new Error("Snapshot missing");
    const canonicalRequest = '{"synthetic":"registration intent"}';
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "REGISTER_ARTWORK" as const,
      idempotencyKey: "registration-guard",
      requestHash: hash(canonicalRequest),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [metadataValues.documentHash],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    // A newer approved snapshot arrives after load, before simulation/save completes.
    await db.insert(artworkMetadataVersions).values({ ...metadataValues, version: 2 });
    const raced = await store
      .operations(before)
      .save(operation, address, artwork.kathaId, preparation);
    expect(raced.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, operation.idempotencyKey)),
    ).toHaveLength(0);
    const current = await store.load(artwork.kathaId);
    if (!current) throw new Error("Snapshot missing");
    const saved = await store
      .operations(current)
      .save(operation, address, artwork.kathaId, preparation);
    expect(saved.status).toBe("saved");
    const { createArtworkRegistrationStatusStore } = await import("../src/index.js");
    const readStatus = createArtworkRegistrationStatusStore(db, "LOCALNET");
    expect(await readStatus(artwork.kathaId)).toEqual({
      finalized: false,
      unresolved: false,
      receipt: null,
    });
    if (saved.status !== "saved") throw new Error("Preparation missing");
    const signature = "9".repeat(88);
    await db.insert(transactionReceipts).values({
      operationId: saved.operationId,
      cluster: "LOCALNET",
      signature,
      messageHash: preparation.messageHash,
    });
    // A newer unsigned operation cannot hide this older unresolved signed attempt.
    await db
      .insert(blockchainOperations)
      .values({ ...operation, idempotencyKey: "unsigned-after-signed" });
    expect(await readStatus(artwork.kathaId)).toMatchObject({
      finalized: false,
      unresolved: true,
      receipt: { signature, status: "UNKNOWN", indexed: false },
    });
    expect(
      await createArtworkRegistrationStatusStore(db, "DEVNET")(artwork.kathaId),
    ).toEqual({ finalized: false, unresolved: false, receipt: null });
    const finalizedAt = new Date();
    await db
      .update(transactionReceipts)
      .set({
        status: "FINALIZED",
        slot: 100n,
        chainRecordedAt: finalizedAt,
        finalizedAt,
        observedAt: finalizedAt,
      })
      .where(eq(transactionReceipts.signature, signature));
    await db
      .update(blockchainOperations)
      .set({ status: "FINALIZED", updatedAt: finalizedAt })
      .where(eq(blockchainOperations.id, saved.operationId));
    expect(await readStatus(artwork.kathaId)).toMatchObject({
      finalized: true,
      unresolved: false,
      receipt: { signature, status: "FINALIZED", indexed: false, slot: "100" },
    });
    await db.insert(indexedEvents).values({
      artworkId: artwork.id,
      cluster: "LOCALNET",
      programAddress: address,
      signature,
      slot: 100n,
      transactionIndex: 0,
      outerInstructionIndex: 0,
      kind: "REGISTRY",
      payload: { synthetic: "ArtworkRegistered" },
      chainRecordedAt: finalizedAt,
    });
    expect((await readStatus(artwork.kathaId)).receipt?.indexed).toBe(true);
    const staleArtist = await store.load(artwork.kathaId);
    if (!staleArtist) throw new Error("Snapshot missing");
    await db
      .update(artists)
      .set({
        verificationStatus: "UNVERIFIED",
        verifiedByWallet: null,
        verifiedAt: null,
      })
      .where(eq(artists.id, artist.id));
    const denied = await store
      .operations(staleArtist)
      .save(
        { ...operation, idempotencyKey: "registration-revoked" },
        address,
        artwork.kathaId,
        preparation,
      );
    expect(denied.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, "registration-revoked")),
    ).toHaveLength(0);
  } finally {
    await connection.close();
  }
});

it("rechecks verification snapshots under save locks and rolls back raced eligibility changes", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const {
    createArtworkVerificationStore,
    artworkMetadataVersions,
    wallets,
    blockchainOperations,
  } = await import("../src/index.js");
  const address = "8".repeat(32);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "verification-guard-artist",
        displayName: "Synthetic Artist",
        biography: "Private test biography",
        region: "Bagmati",
        traditions: ["Paubha"],
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: new Date("2026-10-05T00:00:00.000Z"),
        createdAt: new Date("2026-10-05T00:00:00.000Z"),
        updatedAt: new Date("2026-10-05T00:00:00.000Z"),
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic guarded verification",
        creationYear: 2026,
        authorshipEvidenceHash: "e".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixtures missing");
    const document = JSON.stringify({
      kathaId: artwork.kathaId,
      synthetic: "verification metadata",
    });
    const metadataValues = {
      artworkId: artwork.id,
      version: 1,
      status: "PREPARED" as const,
      authorityWallet: address,
      canonicalDocument: document,
      documentHash: hash(document),
      uri: "http://localhost:3001/synthetic.json",
    };
    await db.insert(artworkMetadataVersions).values(metadataValues);
    const store = createArtworkVerificationStore(db, "LOCALNET");
    const before = await store.load(artwork.kathaId);
    if (!before) throw new Error("Snapshot missing");
    const canonicalRequest = '{"synthetic":"verification intent"}';
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "VERIFY_ARTWORK" as const,
      idempotencyKey: "verification-guard",
      requestHash: hash(canonicalRequest),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [metadataValues.documentHash],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    // A newer approved snapshot arrives after load, before simulation/save completes.
    await db.insert(artworkMetadataVersions).values({ ...metadataValues, version: 2 });
    const raced = await store
      .operations(before)
      .save(operation, address, artwork.kathaId, preparation);
    expect(raced.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, operation.idempotencyKey)),
    ).toHaveLength(0);
    const current = await store.load(artwork.kathaId);
    if (!current) throw new Error("Snapshot missing");
    const saved = await store
      .operations(current)
      .save(operation, address, artwork.kathaId, preparation);
    expect(saved.status).toBe("saved");
    const staleArtist = await store.load(artwork.kathaId);
    if (!staleArtist) throw new Error("Snapshot missing");
    await db
      .update(artists)
      .set({
        verificationStatus: "UNVERIFIED",
        verifiedByWallet: null,
        verifiedAt: null,
      })
      .where(eq(artists.id, artist.id));
    const denied = await store
      .operations(staleArtist)
      .save(
        { ...operation, idempotencyKey: "verification-revoked" },
        address,
        artwork.kathaId,
        preparation,
      );
    expect(denied.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, "verification-revoked")),
    ).toHaveLength(0);
    await db
      .update(artists)
      .set({
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: new Date("2026-10-05T00:00:00.000Z"),
      })
      .where(eq(artists.id, artist.id));
    const {
      transactionReceipts,
      createArtworkVerificationStatusStore,
      createArtworkRegistrationStatusStore,
      indexedEvents,
    } = await import("../src/index.js");
    async function finalize(
      operationId: string,
      cluster: "LOCALNET" | "DEVNET",
      signature: string,
    ) {
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, artwork!.id))
          .for("update");
        const [receipt] = await tx
          .insert(transactionReceipts)
          .values({ operationId, cluster, signature, messageHash: "a".repeat(64) })
          .returning();
        if (!receipt) throw new Error("Receipt missing");
        await tx
          .update(transactionReceipts)
          .set({
            status: "FINALIZED",
            slot: 10n,
            chainRecordedAt: new Date(Date.now() - 2000),
            finalizedAt: new Date(Date.now() - 1000),
          })
          .where(eq(transactionReceipts.id, receipt.id));
      });
    }
    const [other] = await db
      .insert(blockchainOperations)
      .values({
        ...operation,
        cluster: "DEVNET",
        idempotencyKey: "verification-other-cluster",
      })
      .returning();
    if (!other || saved.status !== "saved") throw new Error("Operation missing");
    await finalize(other.id, "DEVNET", "B".repeat(64));
    expect((await store.load(artwork.kathaId))?.verified).toBe(false);
    const beforeFinalization = await store.load(artwork.kathaId);
    if (!beforeFinalization) throw new Error("Snapshot missing");
    const status = createArtworkVerificationStatusStore(db, "LOCALNET");
    expect(await status(artwork.kathaId)).toEqual({
      finalized: false,
      unresolved: false,
      receipt: null,
    });
    await db.insert(transactionReceipts).values({
      operationId: saved.operationId,
      cluster: "LOCALNET",
      signature: "V".repeat(64),
      messageHash: "a".repeat(64),
    });
    expect(await status(artwork.kathaId)).toMatchObject({
      finalized: false,
      unresolved: true,
      receipt: { status: "UNKNOWN", indexed: false },
    });
    expect(
      (
        await store
          .operations(beforeFinalization)
          .save(
            { ...operation, idempotencyKey: "verification-unknown-race" },
            address,
            artwork.kathaId,
            preparation,
          )
      ).status,
    ).toBe("conflict");
    expect(
      await createArtworkRegistrationStatusStore(db, "LOCALNET")(artwork.kathaId),
    ).toEqual({ finalized: false, unresolved: false, receipt: null });
    await db
      .update(transactionReceipts)
      .set({
        status: "FINALIZED",
        slot: 10n,
        chainRecordedAt: new Date(Date.now() - 2000),
        finalizedAt: new Date(Date.now() - 1000),
      })
      .where(eq(transactionReceipts.operationId, saved.operationId));
    expect(await status(artwork.kathaId)).toMatchObject({
      finalized: true,
      unresolved: false,
      receipt: { status: "FINALIZED", slot: "10", indexed: false },
    });
    await db.insert(indexedEvents).values({
      artworkId: artwork.id,
      cluster: "LOCALNET",
      programAddress: address,
      signature: "V".repeat(64),
      slot: 10n,
      eventIndex: 0,
      kind: "REGISTRY",
      transactionIndex: 0,
      outerInstructionIndex: 0,
      payload: { synthetic: true },
      chainRecordedAt: new Date(Date.now() - 2000),
    });
    expect((await status(artwork.kathaId)).receipt?.indexed).toBe(true);

    expect((await store.load(artwork.kathaId))?.verified).toBe(true);
    expect(
      (
        await store
          .operations(beforeFinalization)
          .save(
            { ...operation, idempotencyKey: "verification-finalized-race" },
            address,
            artwork.kathaId,
            preparation,
          )
      ).status,
    ).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, "verification-finalized-race")),
    ).toHaveLength(0);
  } finally {
    await connection.close();
  }
});

it("rechecks condition-attestation snapshots under save locks and rolls back raced eligibility changes", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const {
    createConditionAttestationStore,
    conditionReports,
    wallets,
    blockchainOperations,
  } = await import("../src/index.js");
  const address = "D".repeat(32);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "condition-attestation-guard-artist",
        displayName: "Synthetic Artist",
        biography: "Private test biography",
        region: "Bagmati",
        traditions: ["Paubha"],
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: new Date("2026-10-05T00:00:00.000Z"),
        createdAt: new Date("2026-10-05T00:00:00.000Z"),
        updatedAt: new Date("2026-10-05T00:00:00.000Z"),
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic guarded condition-attestation",
        creationYear: 2026,
        authorshipEvidenceHash: "e".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixtures missing");
    const reportId = randomUUID();
    const conditionDocument = (id: string) =>
      JSON.stringify({
        reportId: id,
        kathaId: artwork.kathaId,
        inspectorId: artist.id,
        verifierWallet: address,
        grade: "GOOD",
        reason: "INITIAL_VERIFICATION",
        inspectedAt: "2026-10-05T00:00:00.000Z",
        reportedAt: "2026-10-05T00:00:00.000Z",
        notes: "Synthetic private notes",
        mediaHashes: ["a".repeat(64)],
      });
    const document = conditionDocument(reportId);
    const metadataValues = {
      id: reportId,
      inspectorId: artist.id,
      grade: "GOOD" as const,
      reason: "INITIAL_VERIFICATION" as const,
      inspectedAt: new Date("2026-10-05T00:00:00.000Z"),
      reportedAt: new Date("2026-10-05T00:00:00.000Z"),
      notes: "Synthetic private notes",
      mediaHashes: ["a".repeat(64)],
      artworkId: artwork.id,
      version: 1,
      status: "PREPARED" as const,
      authorityWallet: address,
      canonicalDocument: document,
      documentHash: hash(document),
    };
    await db.insert(conditionReports).values(metadataValues);
    const store = createConditionAttestationStore(db);
    const before = await store.load(artwork.kathaId);
    if (!before) throw new Error("Snapshot missing");
    const canonicalRequest = '{"synthetic":"condition-attestation intent"}';
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "RECORD_CONDITION" as const,
      idempotencyKey: "condition-attestation-guard",
      requestHash: hash(canonicalRequest),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [metadataValues.documentHash],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    // A newer approved snapshot arrives after load, before simulation/save completes.
    const newerId = randomUUID();
    const newerDocument = conditionDocument(newerId);
    await db.insert(conditionReports).values({
      ...metadataValues,
      id: newerId,
      version: 2,
      canonicalDocument: newerDocument,
      documentHash: hash(newerDocument),
    });
    const raced = await store
      .operations(before)
      .save(operation, address, artwork.kathaId, preparation);
    expect(raced.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, operation.idempotencyKey)),
    ).toHaveLength(0);
    const current = await store.load(artwork.kathaId);
    if (!current) throw new Error("Snapshot missing");
    const saved = await store
      .operations(current)
      .save(operation, address, artwork.kathaId, preparation);
    expect(saved.status).toBe("saved");
    const staleArtist = await store.load(artwork.kathaId);
    if (!staleArtist) throw new Error("Snapshot missing");
    await db
      .update(artists)
      .set({
        verificationStatus: "UNVERIFIED",
        verifiedByWallet: null,
        verifiedAt: null,
      })
      .where(eq(artists.id, artist.id));
    const denied = await store
      .operations(staleArtist)
      .save(
        { ...operation, idempotencyKey: "condition-attestation-revoked" },
        address,
        artwork.kathaId,
        preparation,
      );
    expect(denied.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(
          eq(blockchainOperations.idempotencyKey, "condition-attestation-revoked"),
        ),
    ).toHaveLength(0);
  } finally {
    await connection.close();
  }
});

it("serializes private fulfillment retries and status changes, and rejects stale custody operation snapshots", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const { createCustodyOperationStore, fulfillmentRequests } =
    await import("../src/index.js");
  const address = "E".repeat(32);
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "custody-operation-artist",
        displayName: "Synthetic",
        biography: "Synthetic",
        region: "Bagmati",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Fixture missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic custody",
        creationYear: 2026,
        authorshipEvidenceHash: "a".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixture missing");
    const store = createCustodyOperationStore(db);
    const input = {
      requestId: randomUUID(),
      kind: "DELIVERY" as const,
      recipientName: "Synthetic",
      contactEmail: "synthetic@example.invalid",
      contactPhone: null,
      addressLines: ["Synthetic address"],
      city: "Synthetic",
      region: null,
      postalCode: null,
      countryCode: "NP",
      deliveryInstructions: null,
    };
    const results = await Promise.all([
      store.create(artwork, address, input),
      store.create(artwork, address, input),
    ]);
    expect(results[0]?.id).toBe(input.requestId);
    expect(results[1]?.id).toBe(input.requestId);
    expect(
      await store.create(artwork, address, { ...input, recipientName: "Changed" }),
    ).toBeNull();
    expect(
      await db
        .select()
        .from(fulfillmentRequests)
        .where(eq(fulfillmentRequests.id, input.requestId)),
    ).toHaveLength(1);
    const snapshot = await store.load(artwork.kathaId, input.requestId);
    const found = await store.findRequest(input.requestId);
    if (!found || !snapshot) throw new Error("Snapshot missing");
    const statusInput = {
      expectedUpdatedAt: found.request.updatedAt.toISOString(),
      status: "APPROVED" as const,
    };
    const changed = await Promise.all([
      store.update(found, address, statusInput),
      store.update(found, address, statusInput),
    ]);
    expect(changed.filter(Boolean)).toHaveLength(1);
    const canonicalRequest = '{"synthetic":"custody"}';
    const hash = createHash("sha256").update(canonicalRequest).digest("hex");
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "UPDATE_CUSTODY" as const,
      idempotencyKey: "custody-save-guard",
      requestHash: hash,
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    expect(
      (
        await store
          .operations(snapshot)
          .save(operation, address, artwork.kathaId, preparation)
      ).status,
    ).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, operation.idempotencyKey)),
    ).toHaveLength(0);
    const current = await store.load(artwork.kathaId, input.requestId);
    if (!current) throw new Error("Snapshot missing");
    const savedCustody = await store
      .operations(current)
      .save(operation, address, artwork.kathaId, preparation);
    if (savedCustody.status !== "saved") throw new Error("Custody preparation missing");
    const { createCustodyOperationStatusStore, createOperationReceiptStore } =
      await import("../src/index.js");
    const receiptStore = createOperationReceiptStore(db);
    const readCustodyStatus = createCustodyOperationStatusStore(db, "LOCALNET");
    const latest = await db
      .select()
      .from(blockchainOperations)
      .where(eq(blockchainOperations.idempotencyKey, operation.idempotencyKey));
    if (!latest[0]) throw new Error("Missing custody operation");
    const signedAt = new Date();
    expect(
      (
        await receiptStore.save(
          savedCustody.operationId,
          savedCustody.preparationId,
          wallet.id,
          "LOCALNET",
          "BC".repeat(44),
          preparation.messageHash,
          { status: "UNKNOWN" },
        )
      ).status,
    ).toBe("saved");
    expect(await readCustodyStatus(artwork.kathaId)).toMatchObject({
      unresolved: true,
      receipt: { status: "UNKNOWN", signature: "BC".repeat(44) },
    });
    const replacement = await store
      .operations(current)
      .save(
        { ...operation, idempotencyKey: "custody-replacement" },
        address,
        artwork.kathaId,
        { ...preparation, messageHash: "b".repeat(64) },
      );
    expect(replacement.status).toBe("conflict");
    expect(
      await createCustodyOperationStatusStore(db, "DEVNET")(artwork.kathaId),
    ).toEqual({ finalized: false, unresolved: false, receipt: null });
    const finalizedAt = new Date(Math.max(Date.now(), signedAt.getTime() + 1));
    expect(
      (
        await receiptStore.save(
          savedCustody.operationId,
          savedCustody.preparationId,
          wallet.id,
          "LOCALNET",
          "BC".repeat(44),
          preparation.messageHash,
          { status: "FINALIZED", slot: 101n, chainRecordedAt: finalizedAt },
        )
      ).status,
    ).toBe("saved");
    const next = await store
      .operations(current)
      .save(
        { ...operation, idempotencyKey: "custody-after-finalized" },
        address,
        artwork.kathaId,
        { ...preparation, messageHash: "c".repeat(64) },
      );
    if (next.status !== "saved")
      throw new Error("Next custody preparation blocked by past finalized movement");
    expect(
      (
        await receiptStore.save(
          next.operationId,
          next.preparationId,
          wallet.id,
          "LOCALNET",
          "CD".repeat(44),
          "c".repeat(64),
          { status: "FAILED", failureCode: "TRANSACTION_FAILED" },
        )
      ).status,
    ).toBe("saved");
    expect(await readCustodyStatus(artwork.kathaId)).toMatchObject({
      finalized: true,
      unresolved: false,
      receipt: { status: "FAILED", signature: "CD".repeat(44), indexed: false },
    });
    const secondRequest = await store.create(artwork, address, {
      ...input,
      requestId: randomUUID(),
    });
    expect(secondRequest).not.toBeNull();
    const firstPage = await store.listRequests(artwork.id, { limit: 1, offset: 0 });
    const secondPage = await store.listRequests(artwork.id, { limit: 1, offset: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    expect(firstPage.items[0]?.id).not.toBe(secondPage.items[0]?.id);
    expect(await store.listRequests(randomUUID(), { limit: 1, offset: 0 })).toEqual({
      items: [],
      hasMore: false,
    });
    const approved = await store.findRequest(input.requestId);
    if (!approved) throw new Error("Snapshot missing");
    expect(
      await store.update(approved, address, {
        expectedUpdatedAt: approved.request.updatedAt.toISOString(),
        status: "RECEIVED",
      }),
    ).toBeNull();
    const dispatched = await store.update(approved, address, {
      expectedUpdatedAt: approved.request.updatedAt.toISOString(),
      status: "DISPATCHED",
      courier: "Synthetic",
    });
    if (!dispatched) throw new Error("Dispatch missing");
    const dispatchedSnapshot = await store.findRequest(input.requestId);
    if (!dispatchedSnapshot) throw new Error("Snapshot missing");
    expect(
      await store.update(dispatchedSnapshot, address, {
        expectedUpdatedAt: dispatched.updatedAt.toISOString(),
        status: "RECEIVED",
        courier: "Changed",
      }),
    ).toBeNull();
    expect(
      await store.update(dispatchedSnapshot, address, {
        expectedUpdatedAt: dispatched.updatedAt.toISOString(),
        status: "RECEIVED",
      }),
    ).toMatchObject({ status: "RECEIVED" });
    expect(
      await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.artworkId, artwork.id)),
    ).toHaveLength(0);
  } finally {
    await connection.close();
  }
});

it("serializes competing mint intents, refreshes same-key preparation and rejects stale documents", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const { createArtworkMintStore } = await import("../src/index.js");
  const address = "F".repeat(32),
    otherAddress = "G".repeat(32);
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "mint-guard-artist",
        displayName: "Synthetic",
        biography: "Synthetic",
        region: "Bagmati",
        traditions: ["Paubha"],
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: new Date("2026-10-05T00:00:00.000Z"),
        createdAt: new Date("2026-10-05T00:00:00.000Z"),
        updatedAt: new Date("2026-10-05T00:00:00.000Z"),
      })
      .returning();
    if (!artist) throw new Error("Fixture missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic mint",
        creationYear: 2026,
        authorshipEvidenceHash: "a".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    const [other] = await db
      .insert(wallets)
      .values({ address: otherAddress })
      .returning();
    if (!artwork || !wallet || !other) throw new Error("Fixture missing");
    const document = JSON.stringify({
      kathaId: artwork.kathaId,
      synthetic: "mint metadata",
    });
    const [metadata] = await db
      .insert(artworkMetadataVersions)
      .values({
        artworkId: artwork.id,
        version: 1,
        status: "PREPARED",
        authorityWallet: address,
        canonicalDocument: document,
        documentHash: hash(document),
        uri: "http://localhost/synthetic.json",
      })
      .returning();
    const reportId = randomUUID();
    const at = "2026-10-05T00:00:00.000Z";
    const reportDocument = JSON.stringify({
      reportId,
      kathaId: artwork.kathaId,
      inspectorId: artist.id,
      verifierWallet: address,
      grade: "GOOD",
      reason: "INITIAL_VERIFICATION",
      inspectedAt: at,
      reportedAt: at,
      notes: "Synthetic notes",
      mediaHashes: ["a".repeat(64)],
    });
    await db.insert(conditionReports).values({
      id: reportId,
      artworkId: artwork.id,
      version: 1,
      status: "PREPARED",
      authorityWallet: address,
      canonicalDocument: reportDocument,
      documentHash: hash(reportDocument),
      inspectorId: artist.id,
      grade: "GOOD",
      reason: "INITIAL_VERIFICATION",
      inspectedAt: new Date(at),
      reportedAt: new Date(at),
      notes: "Synthetic notes",
      mediaHashes: ["a".repeat(64)],
    });
    const store = createArtworkMintStore(db, "LOCALNET");
    const snapshot = await store.load(artwork.kathaId, reportId);
    if (!snapshot || !metadata) throw new Error("Snapshot missing");
    const canonicalRequest = '{"synthetic":"mint intent"}';
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "MINT_ARTWORK" as const,
      idempotencyKey: "mint-one",
      requestHash: hash(canonicalRequest),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [metadata.documentHash!],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    const results = await Promise.all([
      store
        .operations(snapshot, wallet.id, "mint-one")
        .save(operation, address, artwork.kathaId, preparation),
      store
        .operations(snapshot, other.id, "mint-two")
        .save(
          { ...operation, walletId: other.id, idempotencyKey: "mint-two" },
          otherAddress,
          artwork.kathaId,
          preparation,
        ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["conflict", "saved"]);
    const winner =
      results[0]!.status === "saved"
        ? { walletId: wallet.id, address, key: "mint-one" }
        : { walletId: other.id, address: otherAddress, key: "mint-two" };
    const winningOperation = {
      ...operation,
      walletId: winner.walletId,
      idempotencyKey: winner.key,
    };
    const guard = store.operations(snapshot, winner.walletId, winner.key);
    const retry = await guard.save(
      winningOperation,
      winner.address,
      artwork.kathaId,
      preparation,
    );
    expect(retry.status).toBe("saved");
    if (retry.status === "saved")
      expect(retry.operationId).toBe(
        results[0]!.status === "saved"
          ? results[0]!.operationId
          : results[1]!.status === "saved"
            ? results[1]!.operationId
            : "missing",
      );
    const refresh = await guard.save(
      winningOperation,
      winner.address,
      artwork.kathaId,
      {
        ...preparation,
        messageHash: "b".repeat(64),
        transactionBase64: "AAAB",
        lastValidBlockHeight: 200n,
      },
    );
    expect(refresh.status).toBe("saved");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(
          and(
            eq(blockchainOperations.artworkId, artwork.id),
            eq(blockchainOperations.kind, "MINT_ARTWORK"),
          ),
        ),
    ).toHaveLength(1);
    expect(
      (
        await guard.save(
          { ...winningOperation, requestHash: "c".repeat(64) },
          winner.address,
          artwork.kathaId,
          preparation,
        )
      ).status,
    ).toBe("conflict");
    const devnet = createArtworkMintStore(db, "DEVNET");
    const devSnapshot = await devnet.load(artwork.kathaId, reportId);
    if (!devSnapshot) throw new Error("Snapshot missing");
    expect(
      (
        await devnet
          .operations(devSnapshot, wallet.id, "mint-devnet")
          .save(
            { ...operation, cluster: "DEVNET", idempotencyKey: "mint-devnet" },
            address,
            artwork.kathaId,
            preparation,
          )
      ).status,
    ).toBe("saved");
    await db.insert(artworkMetadataVersions).values({
      artworkId: artwork.id,
      version: 2,
      status: "PREPARED",
      authorityWallet: address,
      canonicalDocument: document,
      documentHash: hash(document),
      uri: "http://localhost/synthetic-v2.json",
    });
    expect(
      (await guard.save(winningOperation, winner.address, artwork.kathaId, preparation))
        .status,
    ).toBe("conflict");
    const newer = await store.load(artwork.kathaId, reportId);
    if (!newer) throw new Error("Snapshot missing");
    await db
      .update(artists)
      .set({
        verificationStatus: "UNVERIFIED",
        verifiedByWallet: null,
        verifiedAt: null,
      })
      .where(eq(artists.id, artist.id));
    expect(
      (
        await store
          .operations(newer, winner.walletId, winner.key)
          .save(winningOperation, winner.address, artwork.kathaId, preparation)
      ).status,
    ).toBe("conflict");
  } finally {
    await connection.close();
  }
});

it("rechecks metadata revision snapshots under save locks and rolls back raced eligibility changes", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const {
    createMetadataRevisionStore,
    artworkMetadataVersions,
    wallets,
    blockchainOperations,
  } = await import("../src/index.js");
  const address = "H".repeat(32);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "metadata-guard-artist",
        displayName: "Synthetic Artist",
        biography: "Private test biography",
        region: "Bagmati",
        traditions: ["Paubha"],
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: new Date("2026-10-05T00:00:00.000Z"),
        createdAt: new Date("2026-10-05T00:00:00.000Z"),
        updatedAt: new Date("2026-10-05T00:00:00.000Z"),
      })
      .returning();
    if (!artist) throw new Error("Artist missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic guarded revision",
        creationYear: 2026,
        authorshipEvidenceHash: "e".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixtures missing");
    const document = JSON.stringify({
      kathaId: artwork.kathaId,
      synthetic: "revision metadata",
    });
    const metadataValues = {
      artworkId: artwork.id,
      version: 1,
      status: "PREPARED" as const,
      authorityWallet: address,
      canonicalDocument: document,
      documentHash: hash(document),
      uri: "http://localhost:3001/synthetic.json",
    };
    await db.insert(artworkMetadataVersions).values(metadataValues);
    const store = createMetadataRevisionStore(db, "LOCALNET");
    const before = await store.load(artwork.kathaId);
    if (!before) throw new Error("Snapshot missing");
    const canonicalRequest = '{"synthetic":"metadata revision intent"}';
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "REVISE_METADATA" as const,
      idempotencyKey: "metadata-guard",
      requestHash: hash(canonicalRequest),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [metadataValues.documentHash],
    };
    const preparation = {
      canonicalRequest,
      messageHash: "a".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    // A newer approved snapshot arrives after load, before simulation/save completes.
    await db.insert(artworkMetadataVersions).values({ ...metadataValues, version: 2 });
    const raced = await store
      .operations(before)
      .save(operation, address, artwork.kathaId, preparation);
    expect(raced.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, operation.idempotencyKey)),
    ).toHaveLength(0);
    const current = await store.load(artwork.kathaId);
    if (!current) throw new Error("Snapshot missing");
    const saved = await store
      .operations(current)
      .save(operation, address, artwork.kathaId, preparation);
    expect(saved.status).toBe("saved");
    const retry = await store
      .operations(current)
      .save(operation, address, artwork.kathaId, preparation);
    expect(retry.status).toBe("saved");
    if (saved.status === "saved" && retry.status === "saved")
      expect(retry.operationId).toBe(saved.operationId);
    const staleArtist = await store.load(artwork.kathaId);
    if (!staleArtist) throw new Error("Snapshot missing");
    await db
      .update(artists)
      .set({
        verificationStatus: "UNVERIFIED",
        verifiedByWallet: null,
        verifiedAt: null,
      })
      .where(eq(artists.id, artist.id));
    const denied = await store
      .operations(staleArtist)
      .save(
        { ...operation, idempotencyKey: "metadata-revoked" },
        address,
        artwork.kathaId,
        preparation,
      );
    expect(denied.status).toBe("conflict");
    expect(
      await db
        .select()
        .from(blockchainOperations)
        .where(eq(blockchainOperations.idempotencyKey, "metadata-revoked")),
    ).toHaveLength(0);
  } finally {
    await connection.close();
  }
});

it("atomically reconciles owned prepared receipts, terminal retries and competing success", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url),
    db = connection.db;
  const { createOperationReceiptStore, createOperationPreparationStore } =
    await import("../src/index.js");
  const address = "J".repeat(32); // Persistence-only synthetic identity, never signs.
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "receipt-store-artist",
        displayName: "Synthetic",
        biography: "Synthetic",
        region: "Bagmati",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Fixture missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic receipts",
        creationYear: 2026,
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw new Error("Fixture missing");
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "REGISTER_ARTWORK" as const,
      idempotencyKey: "receipt-store-1",
      requestHash: "a".repeat(64),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: ["b".repeat(64)],
    };
    const preparation = {
      canonicalRequest: '{"synthetic":"receipt preparation"}',
      messageHash: "c".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    operation.requestHash = createHash("sha256")
      .update(preparation.canonicalRequest)
      .digest("hex");
    const preparedStore = createOperationPreparationStore(db),
      store = createOperationReceiptStore(db);
    const prepare = async (key: string) => {
      const saved = await preparedStore.save(
        { ...operation, idempotencyKey: key },
        address,
        artwork.kathaId,
        preparation,
      );
      if (saved.status !== "saved") throw new Error("Preparation failed");
      return saved;
    };
    const first = await prepare("receipt-store-1");
    expect(
      await store.load(first.operationId, first.preparationId, randomUUID()),
    ).toBeNull();
    expect(
      await store.load(first.operationId, first.preparationId, wallet.id),
    ).not.toBeNull();
    const signature = "K".repeat(88);
    const persist = (
      signatureValue: string,
      observation: Parameters<typeof store.save>[6],
    ) =>
      store.save(
        first.operationId,
        first.preparationId,
        wallet.id,
        "LOCALNET",
        signatureValue,
        preparation.messageHash,
        observation,
      );
    const raced = await Promise.all([
      persist(signature, { status: "UNKNOWN" }),
      persist(signature, { status: "UNKNOWN" }),
    ]);
    expect(raced.map((r) => r.status)).toEqual(["saved", "saved"]);
    if (raced[0]!.status === "saved" && raced[1]!.status === "saved")
      expect(raced[0]!.receipt.id).toBe(raced[1]!.receipt.id);
    expect(
      (
        await store.save(
          first.operationId,
          first.preparationId,
          wallet.id,
          "DEVNET",
          "L".repeat(88),
          preparation.messageHash,
          { status: "UNKNOWN" },
        )
      ).status,
    ).toBe("conflict");
    expect(
      (
        await store.save(
          first.operationId,
          first.preparationId,
          wallet.id,
          "LOCALNET",
          "L".repeat(88),
          "d".repeat(64),
          { status: "UNKNOWN" },
        )
      ).status,
    ).toBe("conflict");
    await persist("L".repeat(88), { status: "UNKNOWN" });
    const finalized = {
      status: "FINALIZED" as const,
      slot: 9007199254740993n,
      chainRecordedAt: new Date("2026-10-05T00:00:00.000Z"),
    };
    const finals = await Promise.all([
      persist(signature, finalized),
      persist("L".repeat(88), finalized),
    ]);
    expect(finals.map((r) => r.status).sort()).toEqual(["conflict", "saved"]);
    const winner = finals[0]!.status === "saved" ? signature : "L".repeat(88);
    const replay = await persist(winner, finalized);
    expect(replay.status).toBe("saved");
    if (replay.status === "saved") {
      expect(replay.receipt.slot).toBe(9007199254740993n);
      expect(replay.operationStatus).toBe("FINALIZED");
    }
    expect((await persist("M".repeat(88), { status: "UNKNOWN" })).status).toBe(
      "conflict",
    );
    const loser = winner === signature ? "L".repeat(88) : signature;
    expect(
      (await persist(loser, { status: "FAILED", failureCode: "TRANSACTION_FAILED" }))
        .status,
    ).toBe("saved");
    const second = await prepare("receipt-store-2");
    expect(
      (
        await store.save(
          second.operationId,
          second.preparationId,
          wallet.id,
          "LOCALNET",
          winner,
          preparation.messageHash,
          { status: "UNKNOWN" },
        )
      ).status,
    ).toBe("conflict");
    await expect(
      store.save(
        second.operationId,
        second.preparationId,
        wallet.id,
        "LOCALNET",
        "N".repeat(88),
        preparation.messageHash,
        { ...finalized, slot: -1n },
      ),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(transactionReceipts)
        .where(eq(transactionReceipts.operationId, second.operationId)),
    ).toHaveLength(0);
    const [secondOperation] = await db
      .select()
      .from(blockchainOperations)
      .where(eq(blockchainOperations.id, second.operationId));
    expect(secondOperation?.status).toBe("PREPARED");
    const failed = await store.save(
      second.operationId,
      second.preparationId,
      wallet.id,
      "LOCALNET",
      "N".repeat(88),
      preparation.messageHash,
      { status: "FAILED", failureCode: "TRANSACTION_FAILED" },
    );
    expect(failed.status).toBe("saved");
    if (failed.status === "saved") expect(failed.operationStatus).toBe("FAILED");
    expect(
      (
        await store.save(
          second.operationId,
          second.preparationId,
          wallet.id,
          "LOCALNET",
          "N".repeat(88),
          preparation.messageHash,
          finalized,
        )
      ).status,
    ).toBe("conflict");
    expect(
      await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.artworkId, artwork.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(verifications)
        .where(eq(verifications.artworkId, artwork.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(artworkOwnership)
        .where(eq(artworkOwnership.artworkId, artwork.id)),
    ).toHaveLength(0);
  } finally {
    await connection.close();
  }
});

it("commits activity, ownership and cursors atomically across replay, races and restart", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url),
    db = connection.db;
  const { createActivityStore } = await import("../src/activity-store.js");
  const programs = {
    registry: "R".repeat(32),
    core: "C".repeat(32),
    collection: "D".repeat(32),
  };
  const stream = {
    cluster: "LOCALNET" as const,
    programAddress: programs.registry,
    fromSlot: 10n,
  };
  const sig = (n: number) => `q${String(n).repeat(63)}`;
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "atomic-indexer-artist",
        displayName: "Synthetic",
        biography: "Synthetic",
        region: "Bagmati",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Missing fixture");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic indexing",
        creationYear: 2026,
        authorshipEvidenceHash: "a".repeat(64),
      })
      .returning();
    if (!artwork) throw new Error("Missing fixture");
    const store = createActivityStore(db, programs);
    const assetAddress = "A".repeat(32),
      owner = "B".repeat(32);
    const mint = {
      programAddress: programs.registry,
      signature: sig(3),
      slot: 20n,
      transactionIndex: 1,
      outerInstructionIndex: 0,
      innerInstructionIndex: -1,
      eventIndex: 0,
      kind: "OWNERSHIP" as const,
      kathaId: artwork.kathaId,
      assetAddress,
      payload: {
        name: "ArtworkMinted",
        collection: programs.collection,
        ownerWallet: owner,
      },
      chainRecordedAt: new Date(1000),
    };
    const first = {
      ...stream,
      expected: null,
      head: { signature: sig(3), slot: 20n },
      events: [
        {
          ...mint,
          kind: "REGISTRY" as const,
          assetAddress: null,
          signature: sig(2),
          slot: 19n,
          payload: {
            name: "ArtworkRegistered",
            collection: programs.collection,
            artistId: artwork.artistId,
            category: artwork.category,
            creationYear: artwork.creationYear,
            authorshipEvidenceHash: artwork.authorshipEvidenceHash,
            creatorWallet: null,
          },
        },
        mint,
      ],
    };
    expect(await store.commit(first)).toEqual({ inserted: 2, replay: false });
    expect(await store.commit(first)).toEqual({ inserted: 0, replay: true });
    await expect(
      store.commit({
        ...first,
        events: [
          { ...mint, payload: { ...mint.payload, ownerWallet: "E".repeat(32) } },
        ],
      }),
    ).rejects.toThrow("conflict");
    const coreStream = { ...stream, programAddress: programs.core };
    // Both discovered streams can contain the very same Registry observation.
    expect(await store.commit({ ...first, ...coreStream })).toEqual({
      inserted: 0,
      replay: false,
    });
    const transfer = {
      ...mint,
      programAddress: programs.core,
      kind: "OWNERSHIP" as const,
      kathaId: null,
      signature: sig(4),
      transactionIndex: 2,
      payload: {
        name: "CoreTransfer",
        collection: programs.collection,
        ownerWallet: "E".repeat(32),
      },
    };
    const next = {
      ...coreStream,
      expected: first.head,
      head: { signature: sig(4), slot: 20n },
      events: [transfer],
    };
    // Failure after event insertion rolls back the event and checkpoint too.
    await expect(
      store.commit({
        ...next,
        events: [
          { ...transfer, payload: { ...transfer.payload, ownerWallet: "invalid" } },
        ],
      }),
    ).rejects.toThrow();
    expect(await store.cursor(coreStream)).toEqual(first.head);
    expect(
      await db
        .select()
        .from(indexedEvents)
        .where(
          and(
            eq(indexedEvents.cluster, "LOCALNET"),
            eq(indexedEvents.signature, sig(4)),
          ),
        ),
    ).toHaveLength(0);
    const results = await Promise.all([store.commit(next), store.commit(next)]);
    expect(results.map((r) => r.inserted).sort()).toEqual([0, 1]);
    const restarted = createActivityStore(db, programs);
    expect(await restarted.cursor(coreStream)).toEqual(next.head);
    const later = {
      ...transfer,
      signature: sig(5),
      transactionIndex: 3,
      payload: { ...transfer.payload, ownerWallet: "F".repeat(32) },
    };
    expect(
      await restarted.commit({
        ...next,
        expected: next.head,
        head: { signature: sig(5), slot: 20n },
        events: [later],
      }),
    ).toEqual({ inserted: 1, replay: false });
    // A stale worker cannot advance, even to another signature in the same slot.
    await expect(store.commit(next)).rejects.toThrow("conflict");
    const [projection] = await db
      .select()
      .from(artworkOwnership)
      .where(
        and(
          eq(artworkOwnership.cluster, stream.cluster),
          eq(artworkOwnership.artworkId, artwork.id),
        ),
      );
    expect(projection?.ownerWallet).toBe("F".repeat(32));
    // Delayed Registry observation retains evidence without rewinding the owner.
    expect(
      await store.commit({
        ...stream,
        expected: first.head,
        head: { signature: sig(6), slot: 21n },
        events: [{ ...transfer, signature: sig(6), transactionIndex: 0 }],
      }),
    ).toEqual({ inserted: 1, replay: false });
    const [unchanged] = await db
      .select()
      .from(artworkOwnership)
      .where(
        and(
          eq(artworkOwnership.cluster, stream.cluster),
          eq(artworkOwnership.artworkId, artwork.id),
        ),
      );
    expect(unchanged?.ownerWallet).toBe("F".repeat(32));
    await expect(store.cursor({ ...stream, fromSlot: 11n })).rejects.toThrow(
      "conflict",
    );
    await expect(
      store.commit({ ...first, programAddress: "Z".repeat(32) }),
    ).rejects.toThrow("conflict");
    await expect(
      store.commit({
        ...next,
        expected: { signature: sig(5), slot: 20n },
        head: { signature: sig(7), slot: 22n },
        events: [
          {
            ...transfer,
            signature: sig(7),
            slot: 22n,
            payload: { ...transfer.payload, collection: "Z".repeat(32) },
          },
        ],
      }),
    ).rejects.toThrow("conflict");
    await expect(
      store.commit({
        ...first,
        cluster: "DEVNET",
        events: [
          {
            ...first.events[0]!,
            payload: { ...first.events[0]!.payload, artistId: randomUUID() },
          },
        ],
      }),
    ).rejects.toThrow("conflict");
    await expect(
      store.commit({
        ...next,
        expected: { signature: sig(5), slot: 20n },
        head: { signature: sig(8), slot: 22n },
        events: [
          { ...transfer, signature: sig(8), slot: 22n, assetAddress: "G".repeat(32) },
        ],
      }),
    ).rejects.toThrow("conflict");
    await expect(
      store.commit({ ...first, events: [{ ...mint, signature: sig(9) }] }),
    ).rejects.toThrow("conflict");
    await db
      .update(indexerCheckpoints)
      .set({ gapFromSlot: 10n, gapThroughSlot: 11n })
      .where(
        and(
          eq(indexerCheckpoints.cluster, stream.cluster),
          eq(indexerCheckpoints.programAddress, stream.programAddress),
        ),
      );
    await expect(store.cursor(stream)).rejects.toThrow("conflict");
  } finally {
    await connection.close();
  }
});

it("binds indexer networks, repairs gaps by retained history and never invents ownership on reconciliation", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url),
    db = connection.db;
  const {
    createActivityStore,
    createIndexerRecoveryStore,
    indexerNetworks,
    ownershipReconciliations,
  } = await import("../src/index.js");
  const key = (n: number) => "W".repeat(31) + n;
  const programs = { registry: key(2), core: key(3), collection: key(4) },
    genesis = key(5);
  const stream = {
    cluster: "LOCALNET" as const,
    programAddress: programs.registry,
    fromSlot: 10n,
  };
  const sig = (n: number) => "z".repeat(63) + n;
  try {
    const recovery = createIndexerRecoveryStore(db, programs),
      store = createActivityStore(db, programs);
    expect(await recovery.bindNetwork(stream.cluster, genesis, 40n)).toBe(true);
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "recovery-indexer-artist",
        displayName: "Synthetic",
        biography: "Synthetic",
        region: "Bagmati",
        traditions: ["Paubha"],
      })
      .returning();
    if (!artist) throw new Error("Fixture missing");
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic recovery",
        creationYear: 2026,
        authorshipEvidenceHash: "b".repeat(64),
      })
      .returning();
    if (!artwork) throw new Error("Fixture missing");
    const base = {
      programAddress: programs.registry,
      slot: 10n,
      transactionIndex: 0,
      outerInstructionIndex: 0,
      innerInstructionIndex: -1,
      eventIndex: 0,
      kathaId: artwork.kathaId,
      chainRecordedAt: new Date(1000),
    };
    const registered = {
      ...base,
      signature: sig(1),
      kind: "REGISTRY" as const,
      assetAddress: null,
      payload: {
        name: "ArtworkRegistered",
        collection: programs.collection,
        artistId: artist.id,
        creatorWallet: null,
        category: artwork.category,
        creationYear: 2026,
        authorshipEvidenceHash: artwork.authorshipEvidenceHash,
      },
    };
    const minted = {
      ...base,
      slot: 20n,
      signature: sig(2),
      kind: "OWNERSHIP" as const,
      assetAddress: key(6),
      payload: {
        name: "ArtworkMinted",
        collection: programs.collection,
        ownerWallet: key(7),
      },
    };
    const head = { signature: minted.signature, slot: minted.slot };
    await expect(
      store.commit({ ...stream, expected: null, head, events: [registered, minted] }),
    ).rejects.toThrow("conflict");
    await store.commit({
      ...stream,
      expected: null,
      head,
      events: [registered, minted],
      genesisHash: genesis,
      scannedThroughSlot: 30n,
    });
    await recovery.gap(stream, "HISTORY_UNAVAILABLE", 40n);
    await expect(store.cursor(stream)).rejects.toThrow("conflict");
    const verified = {
      ...registered,
      slot: 15n,
      signature: sig(3),
      payload: { name: "ArtworkVerified" },
    };
    const repair = {
      ...stream,
      expected: head,
      head,
      events: [registered, verified, minted],
      genesisHash: genesis,
      recovery: true,
      scannedThroughSlot: 40n,
    };
    expect(await store.commit(repair)).toEqual({ inserted: 1, replay: false });
    expect(await store.commit(repair)).toEqual({ inserted: 0, replay: false });
    expect((await recovery.checkpoint(stream))?.gapFromSlot).toBeNull();
    const [owner] = await recovery.owners(stream.cluster);
    if (!owner) throw new Error("Missing owner");
    expect(
      await recovery.reconcile(stream.cluster, genesis, owner, {
        slot: 40n,
        owner: key(8),
        status: "PRESENT",
      }),
    ).toBe("MISMATCH");
    expect(
      await recovery.reconcile(stream.cluster, genesis, owner, {
        slot: 39n,
        owner: key(7),
        status: "PRESENT",
      }),
    ).toBe("STALE");
    expect(
      await recovery.reconcile(stream.cluster, genesis, owner, {
        slot: 40n,
        owner: null,
        status: "MISSING",
      }),
    ).toBe("MISSING");
    const [stillOwner] = await db
      .select()
      .from(artworkOwnership)
      .where(
        and(
          eq(artworkOwnership.cluster, stream.cluster),
          eq(artworkOwnership.artworkId, artwork.id),
        ),
      );
    expect(stillOwner?.ownerWallet).toBe(key(7));
    expect(
      await db
        .select()
        .from(indexedEvents)
        .where(eq(indexedEvents.artworkId, artwork.id)),
    ).toHaveLength(3);
    await expect(
      db
        .update(ownershipReconciliations)
        .set({ status: "MATCH", observedOwner: key(8) })
        .where(eq(ownershipReconciliations.artworkId, artwork.id)),
    ).rejects.toThrow();
    const coreStream = { ...stream, programAddress: programs.core };
    const transfer = {
      ...base,
      programAddress: programs.core,
      slot: 40n,
      signature: sig(4),
      kathaId: null,
      assetAddress: key(6),
      kind: "OWNERSHIP" as const,
      payload: {
        name: "CoreTransfer",
        collection: programs.collection,
        ownerWallet: key(8),
      },
    };
    await store.commit({
      ...coreStream,
      expected: null,
      head: { signature: sig(4), slot: 40n },
      events: [transfer],
      genesisHash: genesis,
      scannedThroughSlot: 40n,
    });
    expect(
      await recovery.reconcile(stream.cluster, genesis, owner, {
        slot: 40n,
        owner: key(7),
        status: "PRESENT",
      }),
    ).toBe("STALE");
    const [nextOwner] = await recovery.owners(stream.cluster);
    if (!nextOwner) throw new Error("Missing owner");
    expect(
      await recovery.reconcile(stream.cluster, genesis, nextOwner, {
        slot: 40n,
        owner: key(8),
        status: "PRESENT",
      }),
    ).toBe("MATCH");
    await expect(
      db
        .update(ownershipReconciliations)
        .set({
          sourceEventId: owner.sourceEventId,
          indexedOwner: key(7),
          observedOwner: key(7),
        })
        .where(eq(ownershipReconciliations.artworkId, artwork.id)),
    ).rejects.toThrow();
    // Lagging workers do not permanently poison a healthy genesis binding.
    expect(await recovery.bindNetwork(stream.cluster, genesis, 39n)).toBe(false);
    expect(await recovery.bindNetwork(stream.cluster, genesis, 40n)).toBe(true);
    expect((await recovery.checkpoint(stream))?.gapReason).toBe("NETWORK_CHANGED");
    // Different genesis permanently blocks this dataset and preserves all evidence.
    expect(await recovery.bindNetwork(stream.cluster, key(9), 0n)).toBe(false);
    expect(await recovery.bindNetwork(stream.cluster, genesis, 42n)).toBe(false);
    await expect(store.commit(repair)).rejects.toThrow("conflict");
    await expect(
      db
        .update(indexerNetworks)
        .set({ blocked: false })
        .where(eq(indexerNetworks.registryProgram, programs.registry)),
    ).rejects.toThrow();
    const legacyPrograms = {
      ...programs,
      registry: "X".repeat(32),
      core: "Y".repeat(32),
    };
    await db
      .insert(indexerCheckpoints)
      .values({ ...stream, programAddress: legacyPrograms.registry });
    const legacy = createIndexerRecoveryStore(db, legacyPrograms);
    expect(await legacy.bindNetwork(stream.cluster, genesis, 40n)).toBe(false);
    expect(
      (await legacy.checkpoint({ ...stream, programAddress: legacyPrograms.registry }))
        ?.gapReason,
    ).toBe("NETWORK_UNBOUND");
  } finally {
    await connection.close();
  }
});

it("NFC assignment is race-safe, immutable and never reuses retired identifiers", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL)
    throw new Error("Run through pnpm db:test");
  const connection = createDatabase(url);
  const db = connection.db;
  const store = createNfcTagStore(db);
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: `nfc-${randomUUID()}`,
        displayName: "Synthetic NFC Artist",
        biography: "Synthetic",
        region: "Patan",
        traditions: ["Paubha"],
      })
      .returning();
    const [wallet] = await db
      .insert(wallets)
      .values({ address: "11111111111111111111111111111111" })
      .onConflictDoNothing()
      .returning();
    const actor =
      wallet ??
      (
        await db
          .select()
          .from(wallets)
          .where(eq(wallets.address, "11111111111111111111111111111111"))
      )[0];
    if (!artist || !actor) throw new Error("Missing synthetic NFC fixture");
    const works = await db
      .insert(artworks)
      .values(
        [0, 1, 2].map(() => ({
          artistId: artist.id,
          category: "PAUBHA" as const,
          title: "Synthetic tagged artwork",
          creationYear: 2026,
        })),
      )
      .returning();
    const [first, second, third] = works;
    if (!first || !second || !third) throw new Error("Missing artwork");
    expect(await store.assign("KATHA-PAUBHA-999999", randomUUID(), actor.id)).toEqual({
      status: "not_found",
    });
    const ids = [randomUUID(), randomUUID()];
    const race = await Promise.all(
      ids.map((id) => store.assign(first.kathaId, id, actor.id)),
    );
    expect(race.filter((result) => result.status === "assigned")).toHaveLength(1);
    expect(race.filter((result) => result.status === "conflict")).toHaveLength(1);
    const winning = race.find((result) => result.status === "assigned");
    if (!winning || winning.status !== "assigned") throw new Error("Missing winner");
    const tag = winning.record;
    expect(await store.assign(first.kathaId, tag.tagId, actor.id)).toEqual(winning);
    expect(await store.assign(second.kathaId, tag.tagId, actor.id)).toEqual({
      status: "conflict",
    });
    for (const patch of [
      { artworkId: second.id },
      { tagId: randomUUID() },
      { assignedAt: new Date(0) },
      { retiredByWalletId: actor.id },
      { assignedByWalletId: randomUUID() },
      { retiredAt: new Date(0), retiredByWalletId: actor.id },
    ])
      await expect(
        db.update(nfcTags).set(patch).where(eq(nfcTags.tagId, tag.tagId)),
      ).rejects.toThrow();
    await expect(
      db.delete(nfcTags).where(eq(nfcTags.tagId, tag.tagId)),
    ).rejects.toThrow();
    await expect(
      db.insert(nfcTags).values({
        tagId: randomUUID(),
        artworkId: second.id,
        assignedByWalletId: actor.id,
        retiredAt: new Date(),
        retiredByWalletId: actor.id,
      }),
    ).rejects.toThrow();
    const sameAssignment = randomUUID();
    const retries = await Promise.all(
      [0, 1].map(() => store.assign(second.kathaId, sameAssignment, actor.id)),
    );
    expect(retries.every((value) => value.status === "assigned")).toBe(true);
    expect(retries[0]).toEqual(retries[1]);
    await store.retire(sameAssignment, actor.id);
    const retired = await store.retire(tag.tagId, actor.id);
    expect(retired?.retiredAt).toBeInstanceOf(Date);
    expect(await store.retire(tag.tagId, actor.id)).toEqual(retired);
    expect(await store.get(tag.tagId)).toEqual(retired);
    expect(await store.assign(first.kathaId, tag.tagId, actor.id)).toEqual({
      status: "conflict",
    });
    await expect(
      db
        .update(nfcTags)
        .set({ retiredAt: null, retiredByWalletId: null })
        .where(eq(nfcTags.tagId, tag.tagId)),
    ).rejects.toThrow();
    expect((await store.assign(first.kathaId, randomUUID(), actor.id)).status).toBe(
      "assigned",
    );
    const sharedTag = randomUUID();
    const reuseRace = await Promise.all(
      [second, third].map((work) => store.assign(work.kathaId, sharedTag, actor.id)),
    );
    expect(reuseRace.filter((value) => value.status === "assigned")).toHaveLength(1);
    expect(reuseRace.filter((value) => value.status === "conflict")).toHaveLength(1);
    expect(await store.retire(randomUUID(), actor.id)).toBeNull();
    await expect(
      db.insert(nfcTags).values({
        tagId: randomUUID(),
        artworkId: randomUUID(),
        assignedByWalletId: actor.id,
      }),
    ).rejects.toThrow();
    await expect(
      db.delete(artworks).where(eq(artworks.id, first.id)),
    ).rejects.toThrow();
  } finally {
    await connection.close();
  }
});

it("appends immutable private condition evidence after content freeze and isolates report receipts", async () => {
  const url = process.env.KATHA_TEST_DATABASE_URL;
  if (!url || url !== process.env.DATABASE_URL) throw Error("Run pnpm db:test");
  const connection = createDatabase(url),
    db = connection.db;
  const {
    createArtworkMediaStore,
    createConditionAttestationStore,
    createDocumentPreparationStore,
    createOperationReceiptStore,
    createConditionAttestationStatusStore,
    conditionReports,
    artworkMedia,
  } = await import("../src/index.js");
  const address = "K".repeat(31) + "7",
    at = new Date("2026-10-05T00:00:00.000Z");
  try {
    const [artist] = await db
      .insert(artists)
      .values({
        slug: "inspection-append-artist",
        displayName: "Synthetic inspector artist",
        biography: "Synthetic biography",
        region: "Bagmati",
        traditions: ["Paubha"],
        verificationStatus: "VERIFIED",
        verifiedByWallet: address,
        verifiedAt: at,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    if (!artist) throw Error();
    const [artwork] = await db
      .insert(artworks)
      .values({
        artistId: artist.id,
        category: "PAUBHA",
        title: "Synthetic inspection artwork",
        creationYear: 2026,
        authorshipEvidenceHash: "e".repeat(64),
      })
      .returning();
    const [wallet] = await db.insert(wallets).values({ address }).returning();
    if (!artwork || !wallet) throw Error();
    const reportId = randomUUID();
    const canonicalDocument = JSON.stringify({
      kathaId: artwork.kathaId,
      reportId,
      grade: "GOOD",
      reason: "INITIAL_VERIFICATION",
      inspectorId: artist.id,
      verifierWallet: address,
      notes: "Synthetic private notes",
      mediaHashes: ["a".repeat(64)],
      inspectedAt: at.toISOString(),
      reportedAt: at.toISOString(),
    });
    const reportHash = createHash("sha256").update(canonicalDocument).digest("hex");
    await db.insert(conditionReports).values({
      id: reportId,
      artworkId: artwork.id,
      version: 1,
      status: "PREPARED",
      authorityWallet: address,
      inspectorId: artist.id,
      grade: "GOOD",
      reason: "INITIAL_VERIFICATION",
      inspectedAt: at,
      reportedAt: at,
      notes: "Synthetic private notes",
      mediaHashes: ["a".repeat(64)],
      canonicalDocument,
      documentHash: reportHash,
    });
    const media = {
      kind: "IMAGE" as const,
      role: "HERO" as const,
      visibility: "PUBLIC" as const,
      mimeType: "image/png",
      byteSize: 67n,
      contentHash: "a".repeat(64),
      storageKey: `public/${"a".repeat(64)}.png`,
      altText: "Synthetic artwork",
      caption: null,
    };
    await db
      .insert(artworkMedia)
      .values({ ...media, artworkId: artwork.id, position: 0 });
    const normal = createArtworkMediaStore(db),
      evidence = createArtworkMediaStore(db, true);
    const before = await normal.read(artwork.kathaId);
    expect(before?.editable).toBe(false);
    if (!before) throw Error();
    const next = {
      ...media,
      role: "CONDITION" as const,
      visibility: "PRIVATE" as const,
      contentHash: "c".repeat(64),
      storageKey: `private/${"c".repeat(64)}.png`,
      altText: null,
    };
    await expect(
      normal.write(
        artwork.kathaId,
        before.artwork.updatedAt.toISOString(),
        async (items) => [...items, next],
      ),
    ).rejects.toThrow();
    await expect(
      evidence.write(
        artwork.kathaId,
        before.artwork.updatedAt.toISOString(),
        async (items) => [...items, { ...next, visibility: "PUBLIC" }],
      ),
    ).rejects.toThrow();
    const savedMedia = await evidence.write(
      artwork.kathaId,
      before.artwork.updatedAt.toISOString(),
      async (items) => [...items, next],
    );
    if (!savedMedia) throw Error();
    expect(savedMedia.items[0]).toEqual(before.items[0]);
    expect(savedMedia.items[1]).toMatchObject({
      position: 1,
      role: "CONDITION",
      visibility: "PRIVATE",
    });
    await expect(
      evidence.write(
        artwork.kathaId,
        before.artwork.updatedAt.toISOString(),
        async (items) => [...items, next],
      ),
    ).rejects.toThrow();
    await expect(
      evidence.write(
        artwork.kathaId,
        savedMedia.artwork.updatedAt.toISOString(),
        async (items) => [
          { ...items[0]!, caption: "changed" },
          ...items.slice(1),
          next,
        ],
      ),
    ).rejects.toThrow();
    const store = createConditionAttestationStore(db),
      snapshot = await store.load(artwork.kathaId);
    if (!snapshot) throw Error();
    expect(snapshot.media).toHaveLength(1);
    const operation = {
      artworkId: artwork.id,
      walletId: wallet.id,
      cluster: "LOCALNET" as const,
      kind: "RECORD_CONDITION" as const,
      idempotencyKey: "synthetic-inspection-receipt",
      requestHash: createHash("sha256").update("{}").digest("hex"),
      programAddress: address,
      expectedAccounts: [address],
      expectedHashes: [reportHash],
    };
    const preparation = {
      canonicalRequest: "{}",
      messageHash: "f".repeat(64),
      transactionBase64: "AAAA",
      transactionVersion: 0,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      simulationSlot: 10n,
      simulationUnits: 20n,
    };
    const saved = await store
      .operations(snapshot)
      .save(operation, address, artwork.kathaId, preparation);
    if (saved.status !== "saved") throw Error();
    const receipts = createOperationReceiptStore(db),
      status = createConditionAttestationStatusStore(db, "LOCALNET");
    let release!: () => void, entered!: () => void;
    const locked = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      resume = new Promise<void>((resolve) => {
        release = resolve;
      });
    const holder = db.transaction(async (tx) => {
      await tx
        .select({ id: artworks.id })
        .from(artworks)
        .where(eq(artworks.id, artwork.id))
        .for("update");
      entered();
      await resume;
    });
    await locked;
    const saving = receipts.save(
      saved.operationId,
      saved.preparationId,
      wallet.id,
      "LOCALNET",
      "5".repeat(88),
      preparation.messageHash,
      { status: "UNKNOWN" },
    );
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const rows = await db.execute(
          sql`select count(*)::integer as waiting from pg_stat_activity where wait_event_type = 'Lock' and query like '%"artworks"%' and query like '%for share%'`,
        );
        blocked = Number(rows[0]?.waiting) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await holder;
    }
    expect(await saving).toMatchObject({ status: "saved" });
    expect((await store.load(artwork.kathaId))?.unresolved).toBe(true);
    expect(
      (await createConditionAttestationStore(db, "DEVNET").load(artwork.kathaId))
        ?.unresolved,
    ).toBe(false);
    expect(await status(artwork.kathaId, reportHash)).toMatchObject({
      unresolved: true,
      finalized: false,
      receipt: { status: "UNKNOWN", indexed: false },
    });
    expect(await status(artwork.kathaId, "c".repeat(64))).toEqual({
      unresolved: false,
      finalized: false,
      receipt: null,
    });
    await expect(
      evidence.write(
        artwork.kathaId,
        savedMedia.artwork.updatedAt.toISOString(),
        async (items) => [...items, next],
      ),
    ).rejects.toThrow();
    let built = false;
    const documents = createDocumentPreparationStore(db);
    expect(
      await documents.prepare(
        artwork.kathaId,
        savedMedia.artwork.updatedAt.toISOString(),
        address,
        "CONDITION",
        async () => {
          built = true;
          throw Error("Should be blocked");
        },
      ),
    ).toEqual({ status: "conflict" });
    expect(built).toBe(false);
    expect(
      (
        await store
          .operations(snapshot)
          .save(
            { ...operation, idempotencyKey: "replacement-inspection" },
            address,
            artwork.kathaId,
            preparation,
          )
      ).status,
    ).toBe("conflict");
    expect(
      await receipts.save(
        saved.operationId,
        saved.preparationId,
        wallet.id,
        "LOCALNET",
        "5".repeat(88),
        preparation.messageHash,
        { status: "FINALIZED", slot: 10n, chainRecordedAt: at },
      ),
    ).toMatchObject({ status: "saved" });
    expect(await status(artwork.kathaId, reportHash)).toMatchObject({
      unresolved: false,
      finalized: true,
      receipt: { status: "FINALIZED", indexed: false },
    });
    expect((await store.load(artwork.kathaId))?.unresolved).toBe(false);
    expect((await store.load(artwork.kathaId))?.attested).toBe(true);
    expect(
      (
        await store
          .operations(snapshot)
          .save(
            { ...operation, idempotencyKey: "finalized-replacement" },
            address,
            artwork.kathaId,
            preparation,
          )
      ).status,
    ).toBe("conflict");
    expect(
      await createConditionAttestationStatusStore(db, "DEVNET")(
        artwork.kathaId,
        reportHash,
      ),
    ).toEqual({ finalized: false, unresolved: false, receipt: null });
    const rows = await db
      .select()
      .from(artworkMedia)
      .where(eq(artworkMedia.artworkId, artwork.id))
      .orderBy(asc(artworkMedia.position));
    expect(rows[0]).toEqual(before.items[0]);
    expect(rows).toHaveLength(2);
  } finally {
    await connection.close();
  }
});
