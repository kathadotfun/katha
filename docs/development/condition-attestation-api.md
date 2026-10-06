# Condition attestation preparation

`POST /verifier/artworks/:kathaId/operations/condition` requires a wallet session on
the configured cluster, verifier allowlist membership and the current finalized
Registry verifier authority. Queries and unknown body fields are rejected. Success
is 201 with `unsignedOperationResponseSchema` and `Cache-Control: no-store`.

```json
{
  "idempotencyKey": "inspect-synthetic-artwork-1",
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "reportId": "33333333-3333-4333-8333-333333333333",
  "expectedConditionVersion": 0,
  "supportedTransactionVersions": [0]
}
```

The strict `conditionAttestationRequestSchema` selects the latest PREPARED report
for this artwork, authored by the session wallet. It verifies canonical serialization,
SHA-256, all report fields and exact PRIVATE storage bytes. A stale draft, report,
artist approval, occupied report PDA or condition version returns 409. Unauthorized
requests fail before private document reads. Infrastructure errors are redacted.

## Chain scope and transaction selection

Finalized configuration, artwork, verification, condition head, custody head, Core
asset, target report and Clock are read in one [getMultipleAccounts snapshot](https://solana.com/docs/rpc/http/getmultipleaccounts).
The immutable preceding report is read separately and checked against the head.
Registered attribution, evidence, account owners, sizes, discriminators and PDA
relationships are validated before building an instruction.

- Version zero: `initialize_condition`, with INITIAL_VERIFICATION and no scope.
- Unminted existing head: `record_unminted_condition`, a follow-up reason without scope.
- Minted existing head: `record_minted_condition`, a follow-up reason with hashed scope.

For minted reports, prepare the private condition document with `scope` containing
`ownerWallet`, positive `custodyRevision` and `custodyState` (KATHA_HELD or
COLLECTOR_HELD). The current Core owner and custody revision must match. Katha-held
custody must name the configured custody authority; collector-held custody must name
the current owner. Transit is ineligible. Changing ownership or custody requires a
new immutable report. The Registry rechecks these relationships when executed and
stores the report's owner/revision scope. Existing unscoped document hashes stay valid.

This scoped instruction extends the earlier unminted-only condition instruction;
its IDL and Codama client are regenerated with the program. It does not transfer
ownership, change custody or approve resale.

## Persistence and finalization

The existing operation boundary simulates and retains an unsigned transaction.
Pending intent contains the report ID, local version, hash, reviewed chain version,
draft timestamp and scope; notes, evidence and canonical private bytes are omitted
from responses and pending intent. Parent/shared locks recheck latest report,
artist approval and immutable identity before saving. Local report versions and
on-chain condition versions are separate counters.

Preparation leaves the report PREPARED and creates no finalized inspection,
verification, custody, publication or ownership history. The connected wallet must
review and sign. Finalized receipts are reconciled through the existing receipt endpoint; indexing
applies the condition projection.
Reads and simulation do not reserve chain state; execution retains authoritative
permission, duplicate, timestamp, version, owner and custody checks.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm program:test`, `pnpm program:build`,
`pnpm codegen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
`pnpm format:check`. Tests use synthetic data, mocked API RPC/simulation and an
offline Surfpool lifecycle with the real Core program fixture. No Devnet signing,
deployment, physical inspection or receipt finalization is claimed.

## Protected inspection review and evidence

`GET /verifier/artworks/:kathaId/condition` returns the strict shared
`conditionInspectionReviewSchema`, with finalized condition version, eligible reasons,
current minted owner/custody scope and observation time. It validates chain
relationships and registered attribution before private reads. The latest report's
canonical private bytes are returned only to its author, after exact-byte integrity
checks. Evidence entries contain IDs, hashes, image MIME types and integer-string
sizes; storage keys and private download URLs are omitted.

`POST /verifier/artworks/:kathaId/condition/evidence` accepts multipart `metadata`
and `file` only. Metadata uses `artworkMediaUploadSchema` with role CONDITION,
visibility PRIVATE, image MIME type, approvedPublic false and the saved artwork
timestamp. File MIME/signature, upload limits, stored bytes and hashes are checked.
The store appends one private image after content freeze; existing media are not
updated or reordered. Success is 201 with a refreshed protected review.

`POST /verifier/artworks/:kathaId/documents/condition` now checks the finalized
inspection scope, eligible reason and IDs from the reviewed private-image list before
the existing canonical document preparation boundary saves the report. The caller
supplies a stable new report UUID. The existing response has URI null. Public metadata
is not modified. All three endpoints require the verifier allowlist, correct cluster
and current Registry verifier authority; responses are no-store, queries/body fields
are strict, and errors remain redacted.

An unresolved condition signature for any report on this artwork/cluster blocks
new evidence, report replacement and transaction preparation. Evidence/report writes
recheck under the artwork lock; condition receipt persistence takes its shared lock.
Finalized report-specific receipts block re-attestation of the same report hash.
Status queries isolate operation kind, report hash, artwork and cluster; an earlier
UNKNOWN receipt cannot be hidden by a newer unsigned preparation.

See [inspection administration](condition-inspection-web.md) for the operator flow.
