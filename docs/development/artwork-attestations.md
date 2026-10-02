# Preserved artwork attestations

`@katha/db` exports `artworkMetadataVersions`, `verifications`, `conditionReports`,
their inferred insert/record types, and status, cluster, grade and reason enums.
All three tables reference the permanent artwork's UUID. They preserve documents
and manual work separately from successful finalized chain observations.

## Draft, prepared and finalized records

Records start as `DRAFT`. Draft content can be edited and drafts can be removed.
Identity fields (UUID, artwork UUID, creation timestamp and local version where
present) cannot be reassigned. A draft may omit its document/hash pair; providing
one requires providing both with a matching digest.

Set `PREPARED` only after document preparation and review. Prepared records require
a document and digest; metadata also requires a URI. The exact content, authority,
URI, report fields and hash references are then immutable. Prepared rows cannot
be deleted or reverted to drafts. A later correction creates another record.

Only a prepared row can become `FINALIZED`. Direct finalized inserts and
draft-to-finalized updates fail. Finalization records the cluster (`LOCALNET` or
`DEVNET`), signature, nonnegative bigint slot, chain-recorded timestamp and
finalization timestamp together. Metadata/condition rows also require their
actual chain version. Partial receipts and receipt fields on unfinished records
fail. Finalized rows cannot be updated or deleted, including their receipts.
Explicitly update `updatedAt` when editing or finalizing a row.

These are database consistency guards. They do not fetch transactions, verify
signatures or authorize the caller. Future authenticated APIs, receipt
reconciliation and indexing must verify successful finalized Solana activity,
expected program/account relationships, configured authorities, exact commitment
and network before finalizing. A prepared row is never proof that a transaction
succeeded. Public chain histories must select finalized records and project only
approved public fields. A failed transaction leaves no finalized history.

## Exact documents and hashes

`canonicalDocument` stores exact JSON text rather than a JSONB-normalized copy.
The document must be a JSON object with UTF-8 size between 2 bytes and 1 MiB.
PostgreSQL recomputes SHA-256 over its UTF-8 bytes and checks the supplied lowercase
64-character digest. This uses built-in
[binary string hashing and conversion functions](https://www.postgresql.org/docs/18/functions-binarystring.html).
Whitespace and Unicode bytes affect the hash. No extension or new dependency is
needed.

The publishing boundary must validate the shared document contract and produce
these bytes with `canonicalDocumentBytes`. The database checks byte integrity,
not canonical key ordering or the complete external schema. Store/hash the same
bytes that the storage provider serves; never parse and reserialize an existing
commitment. Prepared documents must contain the artwork's exact `kathaId`.

Manual verification documents also contain matching `evidenceHash`,
`verifierWallet`, `inspectedAt` and optional `notes`. `authorityWallet` records the
metadata author or report verifier; it is a claim until its authorized operation
is reconciled. Inspector timestamps use UTC millisecond strings. Private evidence
stays outside public metadata; inspection documents and internal notes need
authorized access. Never return whole database rows as public responses.

## Metadata and verification history

Metadata rows have local versions from 1 through the u32 maximum, unique per
artwork, plus a URI of at most 200 ASCII bytes. The initial URL constraint requires
HTTP(S), a host, no authority credentials and no fragment; later boundary
validation must fully parse the URL. Earlier records retain their exact URI,
document, author and digest.

Local document `version` and finalized `chainVersion` are separate. An abandoned
prepared attempt can retain local version 2 while a reviewed retry at local
version 3 becomes chain version 2. Finalized metadata/condition chain versions are
unique per artwork and cluster. Do not use local numbering to infer the next
Registry revision; read its actual head. The chain enforces contiguous revisions,
while the database preserves preparation attempts. A URI relocation may preserve
the same document hash in a new version.

The Registry authenticates an artwork once. A partial unique index permits at
most one finalized verification per artwork while retaining unfinished manual
attempts. The evidence digest and inspection timestamp remain distinct from the
document digest and chain-recorded timestamp.

## Condition reports

Condition reports retain their UUID, local version, inspector UUID, verifier,
grade, reason, inspection/report times, notes and one to twenty distinct media
hashes. Grades and reasons match the shared condition contract. Inspector UUIDs
record manual attribution; an inspector profile relation is not yet implemented.
Prepared condition documents must match every field of the shared report
snapshot, including the report ID, Katha ID and ordered media hashes.

Hashes are copied into the report rather than referencing mutable current media
rows, so later media edits/removal cannot rewrite the historical snapshot. Notes
are bounded at 5000 characters and nonblank. Reporting cannot precede inspection.
Optional owner wallet and custody revision must be supplied together; their
presence records scope, not resale approval. Actual ownership/custody eligibility
and authorization remain the relevant chain/API responsibilities.

## Migration and verification

Migration `0003_artwork_attestations.sql` includes generated table definitions,
constraints and indexes, followed by a reviewed custom lifecycle trigger function
and one trigger per table. Drizzle snapshots represent tables but not these
custom guards. Retain the SQL when making later forward migrations; do not replace
it with schema push. Follow the [database guide](database-package.md) for explicit
application to the intended local database.

```bash
pnpm db:generate
pnpm --filter @katha/db typecheck
pnpm db:test
```

Disposable PostgreSQL tests exercise migration replay, exact UTF-8 hashing,
tampering, invalid versions/URIs, draft editing/removal, prepared immutability,
receipt completeness, local-versus-chain retry numbering, duplicate finalized
verification and chain revisions, report/document mismatches, invalid media
hashes/owner scope/times and protected identity. Existing artist, artwork and media
constraint tests remain active. No real evidence, network transaction or
development database is used.
