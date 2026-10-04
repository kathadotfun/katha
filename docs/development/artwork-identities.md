# Artwork identities and allocation

`artworks` uses a generated UUID for relational links and a permanent public
`kathaId`, such as `KATHA-PAUBHA-000001`. Categories are `MANDALA`, `PAUBHA` and
`THANGKA`, matching the shared domain contract. Each artwork references an artist;
the foreign key restricts deletion or replacement of a referenced artist UUID.

## Insert and commit

Import `artworks` and `NewArtworkRecord` from `@katha/db`. Supply the artist UUID,
category, title and creation year. Omit UUID, Katha ID and creator wallet; the insert
trigger allocates the ID and copies the artist's nullable creator wallet.
Use `.returning()` to read the resulting record. Publish the ID only after its
transaction commits.

Each category has a counter from 1 through 999999. The trigger uses an atomic
`INSERT ... ON CONFLICT DO UPDATE` counter operation within the artwork insert.
Concurrent inserts serialize on their category's counter and produce distinct
IDs. Different categories have independent counters. Failed inserts and rolled
back transactions also roll back allocation; their uncommitted numbers can be
allocated again. Exhaustion rejects the insert with SQLSTATE `22003` and constraint
`artwork_id_counters_range`. See PostgreSQL's
[INSERT concurrency guarantee](https://www.postgresql.org/docs/18/sql-insert.html).

Callers cannot supply a nonempty Katha ID or a mismatched creator wallet. Counter
updates cannot decrease the value or change category, and counter deletion is
blocked. Allocation belongs to the database, rather than an application-side
read-then-increment sequence.

The [admin draft API](artwork-drafts-api.md) requires a unique `creationRequestId`.
Migration `0008_artwork_draft_requests.sql` adds its nullable storage column for
historical compatibility, uniqueness constraint and immutable request identity
trigger. Duplicate API requests roll back the attempted allocation and return a
conflict. Direct fixture inserts may leave the column null.

## Permanent attribution and editable content

Update/delete triggers protect UUID, Katha ID, artist UUID, category, creator
wallet, creation year and creation timestamp. Artwork deletion is blocked. An
authorship evidence hash can first be supplied on insert or a later update; once
set, it cannot change or be cleared. Store only the lowercase SHA-256 hex digest,
keeping private evidence outside public records.

Later artist wallet edits do not rewrite an artwork's creator snapshot. A
walletless artist can have artwork records with a null creator wallet. Payout
wallets remain separate artist-profile data. These records do not establish
verification, Core ownership, custody, listing status or inspection approval.

The [admin editing API](artwork-draft-editing-api.md) permits title, descriptive
content and dimension changes only before lifecycle records exist and with a matching
last-update token. Committed content changes require versioned revision workflows.
At the storage layer, title, descriptive content and dimensions remain editable. Update `updatedAt`
explicitly when changing content. Titles must be nonblank and at most 200
characters; creation years range from 1 to 9999. Optional story, technique,
meaning, cultural context and creation process fields have the shared contract's
length bounds and must be nonblank when supplied. Origin defaults to `NP`;
country codes must contain two uppercase letters.

Draft dimensions can all be absent. Otherwise height and width must both be
positive integer millimetres, with optional positive depth. Partial dimensions,
depth alone and nonpositive measurements fail the database constraint. Publication
will require the complete shared artwork contract at its later API boundary.
Wallet constraints check base58 text shape; full address decoding belongs at
the chain boundary. [Ordered media and materials](artwork-media-materials.md)
live in related tables.

## Migration and verification

Apply the reviewed forward migration through `pnpm db:migrate` against the intended
local database, following the [database guide](database-package.md). Migration
`0001_artwork_identities.sql` includes generated tables/checks and custom SQL
functions/triggers. Drizzle snapshots represent the table definitions; retain
and review the custom SQL when adding later forward migrations. Generation alone
does not validate trigger behavior.

```bash
pnpm db:generate
pnpm --filter @katha/db typecheck
pnpm db:test
```

The disposable PostgreSQL suite applies and replays the migration history, then
inserts 24 artworks concurrently through two independent connection pools. It
checks uniqueness, independent category numbering, transaction rollback, missing
artists, forged IDs and attribution, invalid dimensions, immutable fields,
editable content, preserved creator snapshots, capacity exhaustion and counter
protection. Failures assert concrete SQLSTATE values and named constraints where
applicable. These synthetic tests never use the development data volume.
