# Finalized Registry and Core activity

The Solana package provides `createActivityReader`, `decodeFinalizedActivity` and
`decodeRegistryEvent`. The API codebase provides an awaited polling loop and a
read-only inspection command. This is the ingestion boundary; decoded pages are
not yet persisted or exposed as public provenance.

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
transfer candidates must later be bound to registered Katha assets/collections
before producing ownership projections. A count is not proof of Katha provenance.

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
future persistence must deduplicate by transaction/instruction/event identity.

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

Cursor selection, atomic event/checkpoint storage and projection writes belong to
the consuming database layer. Durable replay, restart, complete window ordering,
backfill, retries, gap detection and ownership reconciliation are subsequent work.
The inspector deliberately has no discard-and-advance background mode. It is safe
to run alongside the API as a read-only diagnostic.

## Verification

```bash
pnpm test
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
connecting to an unavailable database. These are synthetic RPC tests, not a claim
of live Devnet receipt verification or an operational durable indexer.
