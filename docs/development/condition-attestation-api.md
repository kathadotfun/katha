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
review and sign. Finalized receipt reconciliation is scheduled for its own step.
Reads and simulation do not reserve chain state; execution retains authoritative
permission, duplicate, timestamp, version, owner and custody checks.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm program:test`, `pnpm program:build`,
`pnpm codegen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
`pnpm format:check`. Tests use synthetic data, mocked API RPC/simulation and an
offline Surfpool lifecycle with the real Core program fixture. No Devnet signing,
deployment, physical inspection or receipt finalization is claimed.
