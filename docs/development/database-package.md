# Database connection and forward migrations

`packages/db` is the Node-only PostgreSQL boundary. It pins Drizzle ORM 0.45.3,
Postgres.js 3.4.9 and Drizzle Kit 0.31.11. Postgres.js supplies the connection pool;
Drizzle supplies typed queries and transactions. Package imports neither read
configuration nor open connections. Domain tables store [artist profiles](artist-profiles.md)
and [artwork identities](artwork-identities.md), with related
[media and materials](artwork-media-materials.md) and
[preserved attestations](artwork-attestations.md),
[manual custody and private fulfillment](custody-fulfillment.md), and
[wallet challenges and sessions](wallet-sessions.md), plus
[pending blockchain operations and receipts](blockchain-operations.md), and
[blockchain events and query projections](blockchain-read-models.md).

## Local configuration

Follow the [local service guide](local-services.md). Copy the safe `.env.example`
to ignored root `.env` if you have not already done so. Set `DATABASE_URL` to match
your Compose database user, password, database name and port. Percent-encode
special characters in the username/password. The example URL has disposable values.
Keep real URLs server-side and outside Git; do not use `NEXT_PUBLIC_` variables.
Changing Compose initialization values does not change an existing volume's user
or password.

```bash
pnpm db:start
pnpm db:generate
pnpm db:migrate
```

The CLI commands run from `packages/db`, load the root `.env` with Node's native
`--env-file-if-exists`, and respect existing shell environment overrides. Generation
can run without a database URL or server. Applying migrations requires
`DATABASE_URL`. There is no fallback connection to a default or remote database.

`drizzle.config.ts` selects PostgreSQL, `src/schema/index.ts` and `drizzle/`.
The first migration creates artist profiles; the second creates artwork records
and category counters. The third adds ordered media and material tables; the
fourth adds metadata versions, verifications and condition reports. The fifth
adds manual custody history and private fulfillment requests. The sixth adds
wallets, single-use challenges and hashed sessions. The seventh adds immutable
blockchain operations and retained transaction receipts. The eighth adds events,
checkpoints and ownership/marketplace projections. The
artwork identity, attestation, custody, wallet-session, blockchain-operation and read-model migrations also contain reviewed SQL functions
and triggers for allocation and permanence, which the table snapshot does not
represent. Review the SQL, snapshot and journal before applying; Drizzle records
applied versions in its migration log schema/table.

## Connection ownership

Server code explicitly creates and closes a connection:

```ts
import { createDatabase, validateDatabaseUrl } from "@katha/db";
import { sql } from "drizzle-orm";

const connection = createDatabase(validateDatabaseUrl(process.env.DATABASE_URL));
try {
  await connection.db.execute(sql`select 1`);
  await connection.db.transaction(async (tx) => {
    // Execute related writes through tx so they commit or roll back together.
    await tx.execute(sql`select 1`);
  });
} finally {
  await connection.close();
}
```

The pool opens lazily, permits ten connections, uses a ten-second connect timeout
and a twenty-second idle timeout. Close drains connections with a five-second
shutdown timeout. Configuration errors omit the URL; caller error/log handling
must also avoid publishing driver errors or credentials. The browser runtime
export remains unavailable. API environment validation and readiness are later steps.

## Review migrations before applying

After adding a domain table, run `pnpm db:generate`, inspect its SQL and snapshot,
and commit the complete migration artifacts alongside the schema. Run
`pnpm db:migrate` explicitly against the intended local database. Applied migrations
are historical records: add a forward migration for later changes instead of
editing applied SQL or journals. Do not use schema push or automatic startup
migrations. Serialize migration commands; concurrent migration runners are not
part of this workflow.

Drizzle records applied migrations in `drizzle.__drizzle_migrations`; rerunning
migrate applies only pending entries. See the official
[Drizzle migration documentation](https://orm.drizzle.team/docs/drizzle-kit-migrate)
and [Postgres.js connection documentation](https://github.com/porsager/postgres).

## Verification

```bash
pnpm --filter @katha/db lint
pnpm --filter @katha/db typecheck
pnpm --filter @katha/db test
pnpm --filter @katha/db build
pnpm db:test
```

The unit suite needs no database. `db:test` requires Docker Engine and the existing
`postgres:18.6` image cached during preparation. If absent, fetch it explicitly
with `docker pull postgres:18.6` before running the tests. It starts a uniquely named
container on a random loopback-only port, with synthetic credentials and no
project data volume or root `.env`. It runs the real migration CLI against the
application migration history and a generated synthetic fixture, checks replay,
transaction commit/rollback, failed migration rollback and closed connections,
then removes its own container and temporary files. It never targets your
Compose development database. Migration fixtures remain separate from the
application schema. Database integration checks run explicitly; ordinary
`pnpm test` runs only database unit tests and needs no Docker.

The [fictional fixture guide](database-fixtures.md) describes `pnpm db:seed` and
fresh-database acceptance tests. Seeding is explicit, local-only and transactional;
it never invents verification or chain activity. CI runs the disposable database
suite alongside workspace checks.

Build output and declarations remain ignored under `packages/db/dist`.

The main `packages/db/tsconfig.json` includes source, tests and the Drizzle config
with Node types, so editor diagnostics and command-line type checking share the
same project. `tsconfig.build.json` emits only `src/`; tests and CLI config never
enter `dist`.
