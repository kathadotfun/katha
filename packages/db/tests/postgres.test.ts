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
    expect(applicationCount).toBe(3);
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
    expect(result[0]?.count).toBe(4);
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
    ).toBe(4);
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
