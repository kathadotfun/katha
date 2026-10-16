# Finalized Registry, Marketplace and Core activity

The Solana package provides `createActivityReader`, `decodeFinalizedActivity` and
`decodeRegistryEvent`. The API codebase provides an awaited polling loop and a
read-only inspection command and an explicit bounded durable worker. Decoded
observations can now be stored atomically with ownership and checkpoints; public
provenance responses are served by the [public provenance API](artwork-provenance-api.md).

## Inspect configured activity

Use the root ignored `.env` configured from `.env.example`, then run:

```bash
pnpm --filter @katha/shared build
pnpm --filter @katha/solana build
pnpm indexer:inspect
```

The inspector validates the same server configuration as the API, including a
syntactically valid `DATABASE_URL`, but never connects to PostgreSQL. It reads one
page each for the configured Registry, Core and Marketplace programs, then exits. Each page has
at most 25 signatures. Output contains only fixed events, cluster and transaction/
activity counts; no raw RPC error, endpoint, instruction, document or payload is
printed. `Ctrl+C`/SIGTERM aborts in-flight requests. It does not sign, submit or
change chain state. No live network access occurs during ordinary API startup.

This command is a bounded preview, not a complete history import. On shared Devnet,
Core's program stream includes unrelated assets and may be busy. Successful Core
transfer candidates are bound by the store to registered Katha assets and the
configured collection before producing ownership projections. A count is not proof of Katha provenance.

## Discovery and exact evidence

`ActivityPageRequest` selects one of the fixed Registry/Core/Marketplace program addresses,
optional `before`/`until` signatures and a page size of 1–100 (default 25). The
worker discovers the Core stream through the configured collection address
(`discoveryAddress`) rather than network-wide Core history: every Core instruction
that changes an asset in a collection must pass that collection, and transfers
outside it were already ignored. A collection-referencing transaction that does not
invoke Core keeps its scan position with no activity, so unrelated references cannot
stall ingestion. Each RPC call has its own 10-second bound. Each
read verifies the configured cluster genesis with the same guard used by receipt
reconciliation. Devnet must match its known genesis; localnet rejects known public
network genesis hashes. The configured RPC remains a trusted evidence provider.

Discovery uses finalized
[getSignaturesForAddress](https://solana.com/docs/rpc/http/getsignaturesforaddress)
with explicit pagination. Duplicate signatures, returned boundary signatures,
non-finalized rows and increasing slot order are rejected. A discovered signature
alone is insufficient: the reader fetches its finalized
[getTransaction](https://solana.com/docs/rpc/http/gettransaction) with JSON encoding
and `maxSupportedTransactionVersion: 1`, and checks signature, slot, supported
legacy/v0/v1 version, source-program account reference and execution result.

The reader also requests finalized
[getBlock](https://solana.com/docs/rpc/http/getblock) signature order, checking exact
signature membership. Block signatures are cached only within a page. Decoded
transactions are sorted by slot and actual transaction index, rather than signature
text. Static keys followed by loaded writable and readonly keys resolve compiled
outer and inner instruction indexes. Lookup descriptors, index uniqueness and loaded
address counts must agree; legacy lookups are rejected. Parsed instructions are not accepted.

Each page retains its cluster/program, first discovered signature, optional
`nextBefore` when the page is full, and validated transactions with stable positions.
Empty pages contain no invented scanned slot. A short page does not prove that an
`until` boundary exists in retained RPC history. Descending discovery pages are only
sorted within each page; consumers must establish complete windows and apply global
ordering before advancing durable projections. Cross-program overlap is expected;
persistence deduplicates by transaction/instruction/event identity.

## Registry events and Core transfers

The Registry currently emits one event per successful instruction using
[Anchor `emit!`](https://www.anchor-lang.com/docs/features/events). The decoder
tracks runtime invoke/success/failure frames and matches them to outer and inner
instructions, including nested CPI depth. It accepts Registry data only inside the
actual Registry frame, checks the generated instruction discriminator/event-family
mapping and event artwork account reference, then uses generated event codecs.
Exact decode/re-encode equality rejects trailing or noncanonical bytes, and permanent
Katha IDs are validated. All seven existing event families are supported.

A successful Registry invocation must contain exactly one matching event. Unknown
Registry event/instruction versions, missing events or truncated/unbalanced logs
stop the page. Data emitted by another program, including a forged Registry payload,
is ignored. Agave's Ed25519/secp256k1/secp256r1 precompiles may have no runtime logs;
only those known programs can be skipped during outer-position matching.

The Core adapter uses the installed generated `TransferV1` serializer for
[Core transfers](https://www.metaplex.com/docs/smart-contracts/core/transfer).
It decodes both direct instructions and nested CPI instructions, preserving asset,
optional collection, effective authority and new owner. It rejects malformed,
trailing or compressed transfer data. The authority may be a delegate; it is never
reported as the previous owner. Umi types remain inside the adapter.

Other Core instruction kinds are not interpreted as transfers. A Registry mint
already supplies initial ownership through `ArtworkMinted`; its Core creation CPI
is not turned into an extra ownership event. Marketplace settlement records correlate
with Core transfer evidence as described below. Compressed assets, burns and arbitrary
Core instruction projections are outside this ingestion scope.

Activities are retained only when their invocation and every enclosing frame
succeed. A failed CPI discards its own and descendant observations, even when the
outer caller handles the error. A failed transaction produces no successful
activities, regardless of its logs. Missing transaction/metadata/block, inconsistent
results, invalid timestamps/indexes or unsupported evidence reject the page; they
never become an empty successful result or a checkpoint advance.

## Worker boundary

`pollActivityPages` reads at most two distinct program streams sequentially and
awaits each consumer before requesting the next page. `runActivityPoller` obtains
fresh consumer-selected requests each cycle, applies a bounded interval and
supports abortable RPC/sleep shutdown. A read or consumer error stops the loop;
it does not silently advance a cursor or hide unresolved evidence.

`recoverActivityStream` freezes a finalized upper slot, reads inclusive pages from
newest to oldest, then applies globally oldest-first observations in one transaction.
Pagination links, same-slot block positions, duplicates, genesis and the saved
signature/slot are checked. Newer activity outside the frozen window is handled
on the next cycle. `ingestActivityStream` remains the simpler single-page boundary;
the runnable worker uses the paginated recovery path.

The adapter validates generated Registry PDAs and preserves chain-only claims as
JSON. The [database store](blockchain-read-models.md#atomic-ingestion) atomically
commits events, ordered ownership and the scanned window. Abort before commit
prevents writes; during commit, the transaction finishes or rolls back. No partial
page acknowledgement occurs. Failed transactions contribute discovery only.

## Run, backfill and inspect recovery

After building packages and applying migrations, run alongside the API:

```bash
pnpm build
pnpm db:migrate
pnpm indexer:run <registered-collection-address> <start-slot>
```

The start must include artwork registration. Collection and start are public
configuration. Registry runs before Core. Every cycle validates the initialized
Registry collection and reads the finalized genesis, ledger floor and upper slot.
The default budget is 100 pages of 100 signatures per stream. `--max-pages=N`
allows 1–1000 pages; a transaction batch still has a 10,000 scoped-event limit.
Limits produce a PAGE_LIMIT gap and preserve the previous cursor. Public Devnet RPC
rate limits (HTTP 429) can still stall a cycle; starting the worker with a dedicated
Devnet endpoint in `KATHA_RPC_URL`/`KATHA_RPC_SUBSCRIPTIONS_URL` avoids that. Check
the plan's batch limits before giving it to the API: some free plans cap
`getMultipleAccounts` below the nine accounts a mint review reads from one snapshot. An existing Core
checkpoint recorded from program-wide discovery may need a backfill, because its
saved boundary need not reference the collection.

For a one-shot full replay from the configured start:

```bash
pnpm indexer:run <registered-collection-address> <start-slot> --backfill --once
```

For an initial historical range ending at an already finalized slot:

```bash
pnpm indexer:run <registered-collection-address> <start-slot> --backfill --once --through-slot=<end-slot>
```

Historical range mode does not compare historical ownership with a current account
snapshot. Its upper bound cannot precede an existing scanned checkpoint. Normal
polling subsequently catches up and reconciles current ownership. The original
start cannot change after acknowledgement. An existing gap automatically selects
full backfill, covering its entire stored range before clearing it.

An initial empty/exhausted stream is accepted only when the reported ledger floor
covers the configured start. `getFirstAvailableBlock` is the node's lowest retained
confirmed block, as described in [Solana RPC documentation](https://solana.com/docs/rpc/http/getfirstavailableblock).
A saved signature must be observed even after a short/exhausted page; pruning,
missing boundaries, malformed evidence and page limits create persisted gaps.
The retention check is conservative, including for archival providers. Neither an
RPC response nor absence of a detected gap is independent proof of complete history.

Only timeout, connection, HTTP 429/5xx and selected transient provider errors are
retried, up to three attempts with 250/500 ms abortable delays. Validation and
permission errors are not retried. Continuous polling waits five seconds after a
recoverable gap or exhausted transient failure. One-shot mode exits unsuccessfully for unresolved gaps, exhausted transient
failures or unresolved current ownership checks.
Uninitialized/mismatched scope and changed network bindings stop the worker with a
redacted failure. Invalid persistence evidence records EVIDENCE_INVALID and requires
complete recovery before advancing the affected checkpoint.

Finalized Core account reads verify context slot, program owner, layout and expected
collection. MATCH/MISMATCH/MISSING/INVALID diagnostics bind the exact indexed source
without inventing history. A race returns STALE and requests another recovery cycle.
A mismatch may reflect activity after the frozen slot; the next backfill can recover
it. Unsupported Core state changes or missing retained history remain explicit gaps.

Inspect recovery through read-only SQL in your configured PostgreSQL client:

```sql
SELECT cluster, program_address, from_slot, scanned_through_slot,
       gap_reason, gap_from_slot, gap_through_slot
FROM indexer_checkpoints;
SELECT cluster, registry_program, genesis_hash, finalized_slot, blocked
FROM indexer_networks;
SELECT cluster, artwork_id, source_event_id, status, observed_slot, checked_at
FROM ownership_reconciliations;
```

Migration preserves checkpoints created before genesis binding as untrusted legacy
state: they become NETWORK_UNBOUND rather than silently adopting today's chain.
For a reset chain or legacy dataset, create a separate local database and apply the
migrations, then backfill verified retained history there. Preserve the old database;
this worker never deletes history or unblocks changed-genesis bindings. Same-genesis
height regression also stops with a gap; catch-up and complete boundary verification
are required before recovery. Same-genesis resets that reproduce identical retained
history cannot be distinguished from that history; missing cursors/changed evidence
remain guarded.

No worker starts automatically with HTTP. No signing, submission, publication,
shipping or manual custody change occurs. Public provenance/status is served by the [provenance API](artwork-provenance-api.md);
Marketplace settlements are indexed with actual integer role distributions and revisioned listing cycles.

## Verification

```bash
pnpm test
pnpm db:test
pnpm lint
pnpm typecheck
pnpm build
pnpm format:check
pnpm codegen:check
```

Tests cover direct and inner activity, failed transactions/CPI rollback, scoped
forgery rejection, all Registry event codecs, loaded keys, malformed/truncated
logs, cluster binding, pagination, block ordering, awaited consumption and abort.
A loopback mock RPC exercises actual Kit transport and numeric transformations;
subprocess tests exercise inspector configuration and all three program reads without
connecting to an unavailable database. Persistence tests verify concurrent replay, exact-content conflicts, same-slot
ownership order, restart, overlapping streams, stale cursor rejection and whole-batch
rollback against disposable PostgreSQL. These use synthetic data; live Devnet
ingestion is not claimed. Recovery tests cover multiple pages, frozen ranges,
missing/pruned history, budgets, resets, retries, races and non-invented ownership.

The [public provenance API](artwork-provenance-api.md) returns retained finalized
events with all three stream checkpoints, persisted network observations and owner-check
freshness. It does not query RPC or turn reconciliation diagnostics into events.

## Marketplace settlement ingestion

Apply migration `0013_marketplace_listing_cycles.sql` with `pnpm db:migrate`
before restarting the worker. Existing synthetic listing rows retain revision 1;
new observations retain each creation revision in a separate row. The same ledger
address can have multiple terminal cycles and sales, but only one active cycle.
Earlier sale terms and fees remain immutable.

Every successful Marketplace invocation must emit its expected generated event
(or no event for eligibility/sale-term initialization). Exact codec round trips,
instruction account positions, expected revision/price and invocation log nesting
bind the event to finalized execution. Purchase requires exactly one successful
Core transfer inside that invocation with the same asset, listing delegate,
buyer and collection. Failed transactions and rolled-back CPI calls contribute no
settlements. Missing or conflicting evidence is a gap, not a fabricated sale.

The worker processes Registry bindings first, then Core and Marketplace streams.
A transaction observed by either stream carries the same event identities. One
cluster advisory lock serializes event, listing, sale, ownership and checkpoint
writes in one database transaction. Replay must reproduce the retained contents.
Terminal events resolve their exact preceding creation revision, including replay
after a later resale. Missing cycles, changed mint/price, duplicate settlement,
stale revision and invalid amounts fail without partial projections or checkpoints.

`artwork_sales` records the actual emitted amounts rather than recalculating from
current fee configuration. Primary artist proceeds occupy `proceeds_amount` with
zero `royalty_amount`; secondary seller proceeds and artist royalty occupy those
fields separately. `platform_fee` is the treasury role amount. All amounts are
integer base units. Recipient overlap does not create an additional payment or
change the role accounting.

Raw settlement and Core transfer evidence are retained separately. The existing
public provenance timeline selects Registry/Core observations and therefore shows
one Core transfer per purchase. Marketplace fee presentation is added in the
collector timeline step; it must replace or correlate that transfer rather than
append a second ownership change. Marketplace checkpoints participate in public
indexing health now. No listing, cancellation or sale changes physical custody,
authorship, private fulfillment records, or historical condition reports.

Tests use synthetic RPC evidence and disposable PostgreSQL, including primary and
secondary sale cycles, concurrent overlapping streams, replay/restart, exact fees,
cancellation and whole-batch rollback. No live Devnet indexing is claimed.
