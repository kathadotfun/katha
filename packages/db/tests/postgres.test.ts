import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import { artists, createDatabase, type NewArtistRecord } from "../src/index.js";

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
    expect(applicationCount).toBe(1);
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
    expect(result[0]?.count).toBe(2);
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
    ).toBe(2);
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
