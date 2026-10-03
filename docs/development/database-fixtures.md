# Fictional database drafts and constraint verification

The development fixture seeds one explicitly fictional, unverified artist and
three artwork drafts: one Mandala, one Paubha and one Thangka. Each draft has
placeholder documentation and two synthetic material names. There are no images,
media URLs, private evidence, wallets, signatures, authenticity/condition records,
custody events, fulfillment requests, operations, indexed events or marketplace
history. The fixture does not represent real artists or physical artworks.

## Local seeding

Start the [local PostgreSQL service](local-services.md), configure the ignored root
`.env`, review/apply [forward migrations](database-package.md), then seed explicitly:

```bash
pnpm db:start
pnpm db:migrate
pnpm db:seed
```

`db:seed` builds the database package and runs its development-only CLI with Node's
native environment-file loading. It does not migrate, clear tables, run on service
startup or contact Solana. Existing shell `DATABASE_URL` overrides the root `.env`.
The command accepts only loopback hosts `localhost`, `127.0.0.1` or `[::1]` and the
local `katha` database, `katha_test`, or the specifically named disposable fixture
databases used by tests. URL query options and remote targets are rejected. It
never prints connection URLs or driver error details. Failure returns a nonzero
exit code with a redacted message; verify target/migrations and reserved identities.

The fixture uses reserved UUIDs and artist slug `synthetic-draft-artist`. Actual
Katha IDs are allocated by the database, so they depend on existing category
counters. The CLI prints created counts and resulting Katha IDs, without credentials.

Seeding is transactional and serialized through a seed-specific advisory lock.
The second invocation creates nothing and does not consume additional permanent
IDs. Existing drafts, profile edits and material removals are preserved; rerunning
the seed does not reset them. A reserved artist UUID with a different slug, or a
reserved artwork UUID with another artist/category, fails the entire transaction.
A duplicate reserved slug also fails rather than adopting a different artist.
All fixture writes and allocations roll back if any creation fails.

Fictional drafts consume permanent IDs in a local database like other drafts.
There is no reset command because artwork identity/counter guards preserve history.
Use a separately provisioned disposable database for a clean test; do not remove
real data or disable identity triggers to reset fixtures.

The reusable fixture helper lives under `packages/db/src/development/` and is
not exported from the application package entry point. CLI target validation runs
before connecting. Tests can call the transaction helper against their explicitly
owned disposable database; it does not select targets or read the environment.

## Database phase acceptance

Run the complete suite with Docker and the pinned `postgres:18.6` image available:

```bash
pnpm --filter @katha/db test
pnpm db:test
```

Unit tests cover connection configuration and the seed command's allowed/rejected
targets. `pnpm db:test` starts a disposable container with synthetic credentials and
no development volume. Alongside the existing migration/domain integration cases,
the fixture suite creates uniquely named empty databases within that container,
applies all eight application migrations twice, and removes those databases after
each case. It never uses the development `.env` or Compose data.

The fresh-database checks verify all twenty application tables are present, no
synthetic migration probe leaks into the application schema, concurrent seeds
produce one artist and three drafts, repeated seeding preserves edits and counters,
and the built CLI works against its owned local target. Empty chain/session/
fulfillment tables demonstrate that seeding creates drafts without invented history.
Constraint cases verify immutable attribution, restricted artist deletion, missing
material parents and artist slug validation. A reserved identity collision after
partial seed work proves full rollback, including category allocations.

The existing domain suite verifies bounded profiles and media, permanent concurrent
IDs, historical attestation commitments, custody transitions, private fulfillment,
wallet challenge replay and revocation, expected operation/receipt relationships,
indexed event identity, checkpoint/projection rollback and exact token amounts.
These are relational checks; SQL cannot authenticate wallets or prove RPC activity.

CI fetches the pinned PostgreSQL image and runs the same disposable suite. No
credentials, keys or persistent CI database are required. Schema/migration changes
must keep these tests passing and preserve the reviewed custom trigger SQL. This
fixture step adds no migration or schema changes.
