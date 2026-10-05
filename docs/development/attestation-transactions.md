# Verifier transaction preparation

`@katha/solana` exports three unsigned Registry transaction builders:

| Builder                                   | Operation                                         | Required snapshots                                                       |
| ----------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `buildVerifyArtworkTransaction`           | Authenticate the registered authorship commitment | Configuration and artwork                                                |
| `buildInitializeConditionTransaction`     | Record initial condition at version 1             | Configuration, artwork, and verification                                 |
| `buildRecordUnmintedConditionTransaction` | Append a pre-mint report                          | Configuration, artwork, verification, condition head, and current report |

All use the [Registry transaction context](registration-transactions.md): explicit
cluster, supported version, fee payer, authority, recent blockhash lifetime, and
current block height. The verifier authority pays new account rent; the fee payer
can be a different wallet. Results contain one generated instruction, an unsigned
Kit message, required signer addresses, and canonical PDA addresses. Preparation
does not fetch, simulate, sign, submit, or establish a successful attestation.
Later API and wallet operations supply those steps and reconcile finalized receipts.

## Authentication

Supply `VerifierArtworkAccounts` with existing, finalized encoded configuration
and artwork snapshots from the configured cluster. Snapshots must include
existence information, as returned by the account-fetching helpers. The builder
checks program ownership, discriminator, allocated size, PDA bumps, permanent
ID/category, configured collection, and verifier authority.

```ts
const prepared = await buildVerifyArtworkTransaction(context, accounts, {
  kathaId: "KATHA-PAUBHA-000001",
  expectedAuthorshipEvidenceHash: inspectedEvidenceHash,
});
```

The lowercase SHA-256 hash must be nonzero and equal the immutable artwork
commitment. The generated verification PDA records authentication separately
from custody, condition, and digital ownership. Repeat verification is rejected
by the program's account initialization constraint.

## Canonical condition reports

Both condition builders accept `ConditionAttestationInput`:

- `document`: the shared `ConditionReportDocument`;
- `commitment`: the shared `ConditionReportCommitment`;
- `currentUnixTimestamp`: a positive integer `bigint` from a current chain-clock
  snapshot, in seconds.

The builders parse the shared schemas, require matching report and artwork IDs,
require the document's verifier wallet to match the authority, and recompute
SHA-256 over the canonical document bytes. A mismatched commitment rejects the
operation. Store those same canonical bytes outside Git; hashing is not storage
or publication. Notes and media hashes are covered by the document commitment,
but detailed document content is not returned in the prepared transaction or
encoded in instruction data.

Report and inspector UUIDs must use canonical lowercase spelling and valid
version/variant bits. The generated instruction uses 16-byte UUIDs and enum
values. Canonical document timestamps retain their millisecond precision;
on-chain `inspected_at` is the timestamp rounded down to whole Unix seconds.
Inspection must be positive, and report time must be no later than the supplied
clock snapshot at that second precision. The program rechecks inspection time
against its execution clock.

Initialization requires `INITIAL_VERIFICATION` and produces version 1. It needs
an existing verification attestation linked to the same artwork and evidence
hash. Both condition builders reject artworks with a bound Core asset: these
instructions deliberately leave owner and custody-revision scopes empty.

Follow-up reports require `PRE_SALE` or `INSURANCE` and an explicit integer
`expectedVersion`. The builder verifies the condition head and current report's
owners, discriminators, PDAs, bumps, artwork, version, hash, and empty scopes.
It derives `nextVersion = expectedVersion + 1` with a checked u32 boundary and
rejects reuse of the current report UUID. Other duplicate report UUIDs, already
initialized heads, and races after preparation are rejected atomically on chain.
These pre-mint reports do not approve collector-held resale; that workflow must
validate live ownership and custody separately.

```ts
const prepared = await buildRecordUnmintedConditionTransaction(context, accounts, {
  document,
  commitment,
  currentUnixTimestamp,
  expectedVersion: 1,
});
```

The sample variables are supplied by the caller. Account snapshots and blockhash
lifetimes can become stale; simulation, wallet approval, and finalized receipt
checks are required in the eventual operation workflow.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm program:test
pnpm codegen:check
pnpm format:check
```

Synthetic unit tests cover generated encoding, unsigned signatures, report
tampering, identity and verifier mismatch, forged account relationships, invalid
timestamps/reasons/versions, minted boundaries, and owner/custody scope rejection.
The LiteSVM lifecycle executes builder-prepared authentication and both condition
instructions against the Registry binary, verifies stored hashes and versions,
and preserves earlier reports. Existing program authorization and rollback tests
continue to run alongside the offline Surfpool harness.

Kit provides [unsigned instruction composition](https://www.solanakit.com/api/functions/appendTransactionMessageInstruction)
and [address-based no-op signers](https://www.solanakit.com/api/functions/createNoopSigner).
The builders remove signer implementations from their results while preserving
the required account roles for later wallet approval.

[Condition attestation preparation](condition-attestation-api.md) selects initial,
unminted or minted condition instructions. Minted follow-up reports bind the current
Core owner and held custody revision in their hashed private document; execution
rechecks scope. Preparation does not finalize inspection state or approve resale.
