import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import { createDatabase } from "../src/index.js";

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
    // Exercise the real application migration command, including an empty journal.
    cli("migrate");
    cli("migrate");
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
    expect(result[0]?.count).toBe(1);
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
    ).toBe(1);
    await connection.close();
    await expect(connection.db.execute(sql`select 1`)).rejects.toThrow();
  } finally {
    await connection.close();
    await rm(folder, { recursive: true, force: true });
  }
}, 60_000);
