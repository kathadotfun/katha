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
    expect(applicationCount).toBe(6);
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
    expect(result[0]?.count).toBe(7);
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
    ).toBe(7);
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
