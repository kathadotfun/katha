# Finalized Registry and Core activity

The Solana package provides `createActivityReader`, `decodeFinalizedActivity` and
`decodeRegistryEvent`. The API codebase provides an awaited polling loop and a
read-only inspection command and an explicit bounded durable worker. Decoded
observations can now be stored atomically with ownership and checkpoints; public
provenance responses remain a separate feature.

## Inspect configured activity

Use the root ignored `.env` configured from `.env.example`, then run:

```bash
pnpm --filter @katha/shared build
pnpm --filter @katha/solana build
pnpm indexer:inspect
```

The inspector validates the same server configuration as the API, including a
syntactically valid `DATABASE_URL`, but never connects to PostgreSQL. It reads one
page each for the configured Registry and Core program, then exits. Each page has
at most 25 signatures. Output contains only fixed events, cluster and transaction/
activity counts; no raw RPC error, endpoint, instruction, document or payload is
printed. `Ctrl+C`/SIGTERM aborts in-flight requests. It does not sign, submit or
change chain state. No live network access occurs during ordinary API startup.

This command is a bounded preview, not a complete history import. On shared Devnet,
Core's program stream includes unrelated assets and may be busy. Successful Core
transfer candidates are bound by the store to registered Katha assets and the
configured collection before producing ownership projections. A count is not proof of Katha provenance.

## Discovery and exact evidence

`ActivityPageRequest` selects one of the fixed Registry/Core program addresses,
optional `before`/`until` signatures and a page size of 1–100 (default 25). Each
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
is not turned into an extra ownership event. Marketplace sale semantics and sale/
Core deduplication remain separate work. Compressed assets, burns and arbitrary
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

`ingestActivityStream` reads the durable cursor, requests an inclusive page (no
`until`), verifies that the exact saved signature and slot were reached, then
selects newer transactions by actual block order. At first start it requires an
observed transaction below the configured start slot. Empty/short pages alone
never establish a boundary. A window that exceeds 100 signatures stops safely;
there is no partial acknowledgement or discard-and-advance mode. Failed transactions
can advance discovery but never generate successful events.

The adapter validates Registry configuration/artwork/asset/report/revision PDAs,
filters other Core collections, and preserves chain-only claims as JSON. The
[database store](blockchain-read-models.md#atomic-ingestion) commits retained events,
ownership and the head together. Read/decode/write failures stop the worker; restart
uses the last committed cursor. In-flight aborts before commit prevent writes; if
shutdown arrives during commit, the database transaction completes or rolls back.

## Run the bounded worker

After applying migrations and building workspace packages, run alongside the API:

```bash
pnpm build
pnpm db:migrate
pnpm indexer:run <registered-collection-address> <start-slot>
```

Both arguments are public configuration. Use the collection recorded in the
initialized Registry and a start slot before the first artwork registration. The
worker checks the finalized Registry collection every cycle, ingests Registry
before Core, and waits five seconds between cycles. Each stream must reach its
saved signature within one page. On first start, retained activity below the start
slot must be observable in both streams (for example the Registry deployment).
Slot zero cannot meet this initial boundary rule. The configured start cannot
change after acknowledgement. Existing gap-marked checkpoints are refused.

This is a deliberately bounded ingestion foundation. A busy global Core Devnet
stream, an old cursor, an unknown locally registered artwork, a transfer without
its retained mint, or missing RPC history stops with a redacted failure. The worker
never skips those cases. Pagination/backfill, transient retries, gap reporting and
Core reconciliation are the next recovery work. The stored scanned slot is the
observed head slot, not proof that every historical slot was available. Localnet
reset detection also belongs to recovery; do not reuse old checkpoints on a reset
chain. No automatic worker starts with the HTTP service; no signing/submission,
publication, shipping or manual custody change occurs.

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
subprocess tests exercise inspector configuration and both program reads without
connecting to an unavailable database. Persistence tests verify concurrent replay, exact-content conflicts, same-slot
ownership order, restart, overlapping streams, stale cursor rejection and whole-batch
rollback against disposable PostgreSQL. These use synthetic data; live Devnet
ingestion and complete recovery are not claimed.
