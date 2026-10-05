# Blockchain events and query projections

Migration `0007_blockchain_read_models.sql` adds `indexedEvents`,
`indexerCheckpoints`, `artworkOwnership`, `artworkListings` and `artworkSales` to
`@katha/db`, with inferred record types. These are local query models derived from
successful finalized chain activity. They do not establish authoritative ownership
or authenticate RPC data. Solana/Core remain the ownership source; the
[polling/decoding boundary](chain-activity-ingestion.md) now supplies validated
activity pages; atomic persistence, paginated backfill and account reconciliation
are implemented. Marketplace ingestion remains separate work.

## Event identity and replay

An event stores cluster, program, signature, slot, transaction position, outer
instruction position, inner instruction position and decoded event position.
`innerInstructionIndex = -1` represents the outer instruction. Its unique identity
is `(cluster, signature, outerInstructionIndex, innerInstructionIndex, eventIndex)`;
multiple events and CPI instructions within one transaction remain distinct.
The indexer must use stable decoder positions on every replay and obtain transaction
order within a slot rather than ordering signatures alphabetically.

Events include a kind, optional artwork/asset scope, chain time, indexing time and
a bounded object payload. Ownership, listing and sale kinds require artwork and
asset scope; Registry configuration events may omit them. Payloads contain only
validated public decoded fields and commitments, not raw logs, private evidence,
shipping details or secrets. Event rows cannot be updated or deleted.

Only insert events after verifying finalized success, configured program IDs,
account ownership/discriminators and decoder results. This trusted writer boundary
is not implemented by a SQL constraint. A failed transaction must produce no event
or projection. Events need not reference an API operation: chain activity may
originate outside the application's preparation flow.

On replay, use the unique event identity to avoid duplicate rows and compare the
existing immutable content with the decoded input. A conflicting payload under an
existing identity is an integrity error, not a reason to overwrite history. Atomic
worker replay/backfill compares retained evidence, inserts missing validated rows
and advances projections and checkpoints atomically.

## Checkpoints and gaps

Each cluster/program stream has a nonnegative starting slot, optional scanned-through
slot and optional last signature/slot pair. Signature and slot are all-or-none,
and lie within the configured scanned range. Updates cannot change the stream or
starting slot, clear an established cursor or move either slot backward. Checkpoint
update time comes from the database clock. Slot fields use bigint, not JavaScript
numbers or timestamp infinities.

Optional `gapFromSlot` and `gapThroughSlot` store an inclusive unresolved range;
both must be present, ordered and at or after the starting slot. A worker detecting
multiple gaps may conservatively store an encompassing range until they are
resolved. A non-null gap means the read models may be incomplete, even if the
scanned-through slot is recent. Surface both cursor and gap status in future APIs.
A row with no signature can represent an empty scanned range of transactions.

Persist a batch's events, projection changes and checkpoint in one transaction.
Advance the scanned-through slot only when scanning that batch is complete and
retain gaps until backfill verifies them. A failed write rolls back the entire
batch. The database cannot prove that a worker actually fetched every transaction.
Replay below the current cursor leaves the cursor unchanged; a controlled rebuild
may replace checkpoint/projection rows while retaining immutable event evidence.
No polling, scheduling or maintenance endpoint is included yet.

## Ownership and marketplace views

Ownership is unique per cluster/artwork, with a unique asset address per cluster.
It stores a current owner address and source event. Owner addresses do not need a
wallet-session record. Composite event references and trigger guards bind cluster,
artwork and asset to the event; owner value must match its `ownerWallet`, or a sale
event's `buyerWallet`. Later updates must advance the source position tuple
`(slot, transactionIndex, outerInstructionIndex, innerInstructionIndex, eventIndex)`.
Worker decoding must preserve a consistent ordering across outer and CPI sources;
Core reconciliation remains necessary when owner activity is missing.

Listings preserve their chain address, seller, mint, exact price, expiry and source
event. One ACTIVE listing per cluster/artwork is allowed. ACTIVE, CANCELLED,
PURCHASED and EXPIRED mirror the shared marketplace contract. Updates cannot change
terms, reopen terminal listings or use an older event. A sale event supplies a
PURCHASED listing snapshot; other listing states use a LISTING event. A query for
purchasable listings must require both ACTIVE status and unexpired time; purchase
preparation must still recheck chain state and inspection eligibility.

Sale rows bind to one listing and one SALE event and snapshot buyer, seller, mint,
price, primary/secondary classification, proceeds recipient, artist recipient,
treasury and split amounts. Listing terms and event fields must match. Primary
proceeds go to the artist recipient with zero secondary royalty; secondary proceeds
go to the seller. Recipient overlap is allowed. The amounts must be nonnegative
integers within u64, and proceeds plus royalty plus platform fee must equal price.
These constraints preserve observed settlement, not calculate or configure fees.
Sale updates are rejected; controlled projection rebuilds can delete/reinsert them
from retained events, observing foreign-key order and one-sale-per-listing bounds.

Token fields use unconstrained PostgreSQL `numeric` with integer-scale and u64
checks, mapped to TypeScript bigint. A fixed numeric scale could round fractional
input before checking it, so it is deliberately avoided. See the official
[PostgreSQL numeric documentation](https://www.postgresql.org/docs/18/datatype-numeric.html).
Serialize token amounts and bigint slots as integer decimal strings in JSON.

Payload bindings expect camel-case keys with base-unit amount strings. OWNERSHIP
uses `ownerWallet`. LISTING uses `listingAddress`, `sellerWallet`, `paymentMint`,
`price`, `status` and an ISO timestamp `expiresAt`. SALE adds `buyerWallet`,
`isPrimary` (boolean), `proceedsWallet`, `proceedsAmount`, `artistWallet`,
`royaltyAmount`, `treasuryWallet` and `platformFee`. Its listing snapshot uses status
PURCHASED. The future decoder must construct these normalized public snapshots;
they are not a claim about the current raw Anchor event layout.

Artist attribution and manual physical custody remain separate. A listing does not
move artwork custody, and an owner update does not rewrite the permanent artist.
No synthetic event in these tests represents a real sale or blockchain confirmation.

## Migration and verification

Use the [reviewed migration workflow](database-package.md). Preserve custom trigger
SQL alongside the generated snapshot and journal. Do not edit applied migrations.
`pnpm db:test` uses a disposable synthetic PostgreSQL database and verifies event
identity races, CPI/event separation, immutable evidence, scope binding, stale
owner updates, checkpoint monotonicity/gaps, whole-batch rollback, active listing
uniqueness, fractional/u64 amounts, sale terms and recipients, terminal listings,
and separation of ownership from artist attribution and custody.

## Atomic ingestion

`createActivityStore` is an internal worker boundary. It takes normalized validated
Registry/Core observations, a configured stream start, the expected saved cursor,
and the discovered head. A transaction-scoped advisory lock serializes both streams
within a cluster, including absent rows. Checkpoint comparison rejects stale workers;
repeating the acknowledged head verifies existing event contents instead of inserting
new observations. Position identity deduplicates the same Registry observation
when both program streams discover its transaction. Conflicting retained evidence
stops ingestion. See [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html)
and [Drizzle transactions](https://orm.drizzle.team/docs/transactions).

The store resolves permanent Katha IDs against local immutable attribution. Later
Registry observations require the retained registration. Mint ownership and Core
transfers require the configured collection and a retained asset/artwork binding.
Registry mint is one OWNERSHIP row with `name: ArtworkMinted`, preserving its full
Registry payload and `ownerWallet`; Core creation produces no duplicate row. Other
Registry claims remain REGISTRY events. Chain integers use decimal strings and byte
commitments use lowercase hex; instruction/event positions remain numeric indexes.

Events, monotonic ownership updates and the stream head commit together. Delayed
observations retain evidence but cannot rewind ownership. A failed projection or
checkpoint write rolls back the entire batch. Registration, verification, metadata,
condition and custody claims are retained here as chain events; private prepared
documents and manual custody observations are not rewritten. Public timeline
assembly, history recovery and marketplace projections have separate workflows.

## Recovery and ownership diagnostics

Migration `0011_indexer_recovery.sql` adds a bounded `gapReason`, network bindings
and `ownershipReconciliations`. Bindings preserve the genesis, Registry program and
collection. The finalized-slot high-water mark cannot rewind; a changed genesis
permanently blocks ingestion into that dataset. A lagging node or same-genesis
collection mismatch records a gap and stops without permanently replacing the
binding. Existing unbound checkpoints are marked NETWORK_UNBOUND and cannot be
silently adopted. Use an isolated database for a new chain; preserve old evidence.

A complete backfill uses the original configured start, validates existing events
and reaches the saved cursor before acknowledging the frozen upper slot. Gaps
clear only in that transaction, after covering their stored upper bound. Insertion
of older missing events does not rewind ownership. No range can rewind an existing
scanned-through checkpoint. A failed backfill leaves events and cursors unchanged;
its diagnostic gap remains. Scanned-through now means the completed frozen RPC
window, including windows with no program transactions, rather than only its last
observed signature slot. This relies on the RPC provider's retained address history.

Ownership checks record MATCH, MISMATCH, MISSING or INVALID against the exact current
source event and finalized account context. Stale/raced checks are rejected, and
database triggers bind diagnostics to the current projection. A mismatch records a
Core gap; it never creates a transfer or replaces the indexed owner. A later successful
backfill and match can resolve it. A diagnostic referencing an older source event
must be treated as stale by consumers. Prepared documents and physical custody
remain separate. Public status/timeline responses are provided by the provenance API.
