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
    expect(applicationCount).toBe(11);
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
    expect(result[0]?.count).toBe(12);
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
    ).toBe(12);
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
    const { transactionReceipts } = await import("../src/index.js");
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
    await finalize(saved.operationId, "LOCALNET", "C".repeat(64));
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
