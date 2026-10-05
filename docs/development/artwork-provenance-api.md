# Public artwork provenance and condition history

`GET /artworks/:kathaId/provenance` is anonymous and read-only. It uses the same
publication predicate as discovery and detail: approved artist, published artwork,
finalized verification, metadata, initial inspection and indexed ownership on the
server's configured localnet/Devnet cluster. Ineligible and nonexistent artwork
both return 404. Clients cannot select another cluster or request private content.

## Request and pagination

```bash
curl 'http://localhost:3001/artworks/KATHA-PAUBHA-000001/provenance?limit=20&offset=0'
curl 'http://localhost:3001/artworks/KATHA-PAUBHA-000001/provenance?type=CONDITION&limit=20&offset=0'
```

IDs use the permanent uppercase Katha identifier. Query contracts are exported as
`artworkProvenanceParamsSchema` and `artworkProvenanceQuerySchema` by `@katha/shared`.
`limit` defaults to 20 (1–100); `offset` defaults to 0 (0–100000). Optional `type`
is exactly `REGISTRATION`, `VERIFICATION`, `METADATA`, `CONDITION`, `CUSTODY`, `MINT`
or `TRANSFER`. Duplicate, unknown and malformed parameters return 400.

The response follows `artworkProvenanceResponseSchema`: `kathaId`, immutable
`attribution`, validated `chain` bindings, `items`, numeric `pagination` with
`hasMore`, and `indexing`. Events are oldest-first by slot, transaction index,
outer instruction index, inner instruction index and event index. IDs break ties.
An extra database row determines `hasMore`; it is not emitted. Every HTTP response
uses one read-only repeatable-read database snapshot. Offset pages across separate
requests are not a frozen export: recovery/backfill can insert earlier history.
Restart pagination after backfill or status changes. Exhausting a page is not
proof that the chain history is complete; inspect indexing gaps and coverage.

## Public history and commitments

Each item has its immutable event ID, source program, signature, exact decimal
slot, transaction/block timestamp, instruction position and a typed `data` object.
The source is the successful finalized event retained by the indexer, not a pending
API operation, failed receipt, prepared report or manual fulfillment request.
Ordering uses actual block transaction positions because RPC signature discovery
is [newest-first](https://solana.com/docs/rpc/http/getsignaturesforaddress).

| Type           | Public data                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `REGISTRATION` | Registry address, artist ID, optional creator wallet, authorship commitment, registration authority and time |
| `VERIFICATION` | Authorship commitment, verifier and verification time                                                        |
| `METADATA`     | Version, exact document hash, revision address, authority and commitment time                                |
| `CONDITION`    | Version, report address, report hash, grade, reason, verifier, inspection and recording times                |
| `CUSTODY`      | Revision, prior/new physical custody state, attesting authority and recording time                           |
| `MINT`         | Core asset, initial owner, metadata version/hash, minting authority and time                                 |
| `TRANSFER`     | Core asset, destination wallet and transfer authority                                                        |

Authorship does not change when ownership transfers. Custody events describe
physical movement separately. A transfer authority may be a delegate; it is not
presented as the previous owner. Transfers do not imply a sale, price or delivery.
Marketplace settlement history will be added in its later indexing step.

Registry, asset, metadata revision, condition report and custody transition PDAs
are checked against generated clients before publishing their fields. Registration
must match immutable local attribution; mint and transfer must match its collection
and deterministic asset. Missing indexed bindings stay null; the API does not
invent addresses from prepared operations. Malformed retained evidence returns a
redacted 500 instead of emitting partial or unvalidated history.

Condition-only pages preserve earlier inspections and commitments. Notes, inspector
profile IDs, private photographs, media hashes, canonical report bytes, provider
paths, contact/shipping information and fulfillment details are excluded. A public
hash is an integrity commitment, not access to the private evidence or independent
proof that the physical inspection was correct. This endpoint does not fetch or
rehash documents; document retrieval/integrity behavior is a separate boundary.

## Indexing status

`indexing.network` is nullable. When bound, it reports the dataset's genesis,
collection, last worker-observed finalized slot/time and blocked flag.
`indexing.streams` always lists Registry and Core, each with a nullable checkpoint:
start slot, scanned-through slot, exact lag against the observed head, gap bounds,
reason and update time. These are persisted observations, not fresh RPC calls.
Coverage starts at the configured checkpoint start, not universally at genesis.

`ownerCheck` gives the most recent diagnostic status, observed context slot and
check time. It becomes `STALE` when its indexed source/owner no longer matches,
its observation predates the network head, or its timestamp is outside the freshness
window. It never changes ownership or creates events.

| Status             | Meaning                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAP_DETECTED`     | A checkpoint gap, blocked network or applicable nonmatching Core diagnostic exists; retained events remain available                                                                    |
| `UNKNOWN`          | Network, either stream, registration/mint binding, current ownership or owner check is missing; coverage starts after registration; or checkpoint is ahead of the observed network head |
| `LAGGING`          | Both streams exist, but at least one is behind the worker's last observed finalized slot                                                                                                |
| `STALE`            | Coverage reaches the observed head, but network/checkpoint timestamps or the current owner diagnostic are stale                                                                         |
| `AT_OBSERVED_HEAD` | Both streams cover registration through the observed head, with recent matching owner diagnostics and bound network                                                                     |

The freshness window is 30 seconds, measured against the database transaction's
clock. Future observations cannot qualify as fresh. `AT_OBSERVED_HEAD` describes
that persisted observation only; it is not a guarantee that a newer finalized
transaction does not exist. Existing artwork detail retains its earlier single-source
checkpoint summary; use this provenance endpoint for two-stream and reconciliation
status. Gap recovery is described in [chain ingestion](chain-activity-ingestion.md).

## Checks and operation

Run `pnpm db:migrate` and the configured indexer worker before expecting complete
history. An eligible record awaiting indexed registration returns an empty timeline,
null bindings and unknown status. No wallet connection, signing or RPC request is
made by this endpoint. Newest state, recorded custody and private manual observations
may differ while indexing is incomplete; retain their source labels.

Unit tests cover HTTP validation, privacy, binding rejection, redacted failures,
condition projection and every indexing status. Disposable PostgreSQL tests verify
publication/cluster isolation, reversed insertion order, same-slot chain ordering,
condition filtering, pagination, network observations and gap preservation.
