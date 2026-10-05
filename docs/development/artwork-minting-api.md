# Artwork mint preparation

`POST /admin/artworks/:kathaId/operations/mint` prepares one unsigned atomic Registry
mint transaction. It requires an authenticated session on the configured cluster,
admin allowlist membership and the current finalized Registry registration authority.
Queries and unknown body fields are rejected. Success is 201 with
`unsignedOperationResponseSchema` and `Cache-Control: no-store`.

```json
{
  "idempotencyKey": "synthetic-artwork-mint-1",
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "metadataVersionId": "11111111-1111-4111-8111-111111111111",
  "initialConditionReportId": "22222222-2222-4222-8222-222222222222",
  "expectedMetadataVersion": 1,
  "expectedConditionVersion": 1,
  "expectedCustodyRevision": "1",
  "supportedTransactionVersions": [0]
}
```

`artworkMintRequestSchema` distinguishes the local metadata UUID from the reviewed
on-chain metadata/condition versions and exact decimal-string custody revision.
The initial condition UUID always selects the immutable on-chain version-1 report;
the current condition head may have advanced. Clients cannot supply owner, asset,
collection, signer, hash, URI or arbitrary instructions.

## Prerequisites and integrity

Before private reads the API verifies registration authority. It loads a locked
artwork/artist/latest-metadata/selected-report snapshot. The artist must remain
verified and the artwork unpublished. Local documents may be PREPARED or FINALIZED;
their local status is not treated as proof of chain finalization.

The API validates exact canonical public metadata against permanent artwork
attribution and StorageProvider PUBLIC bytes. It also checks the selected PRIVATE
initial inspection document, SHA-256, row fields and provider bytes. The initial
report must have INITIAL_VERIFICATION reason and no owner/custody scope. Private
notes and evidence never enter pending intent or responses.

The Kit reader first resolves the collection from finalized configuration, then
loads mutable configuration, artwork, verification, metadata head, condition head,
custody head, initial report, collection and deterministic asset in a single
[getMultipleAccounts snapshot](https://solana.com/docs/rpc/http/getmultipleaccounts).
It rejects a changed collection configuration and reads the immutable current
metadata revision separately. The existing mint builder validates account owners,
sizes, discriminators, PDA relationships, verification evidence, initial inspection,
held custody and collection update authority before returning the generated instruction.

The API additionally matches local immutable attribution/evidence, reviewed versions,
metadata URI/hash and initial report hash/verifier/grade/inspector/inspection time.
Unverified artworks, missing initial inspection, transit, occupied deterministic assets,
existing Registry asset bindings and mismatched commitments fail before persistence.

## Idempotent preparation

Only one non-failed mint intent may reserve an artwork on a given cluster. A
transaction-scoped PostgreSQL advisory lock serializes this guard across wallets
and keys, including when no operation row exists yet. It works with the existing
wallet, artwork and document locks without upgrading shared artwork locks.

Keep the original wallet and idempotency key for retries. Identical intent reuses
one operation; the existing preparation store preserves previous attempts and permits
refreshed blockhash/message transport. Reusing the key with changed intent conflicts.
A different key/wallet cannot bypass a pending or finalized reservation. FAILED
operations do not reserve new keys; finalized receipt reconciliation manages operation
outcomes in its scheduled step. This endpoint does not abandon or cancel pending
intents. Merely expiring a blockhash does not release the operation reservation.

Save-time locks recheck the latest metadata, initial report bytes/hash, artist approval,
immutable artwork identity and draft timestamp. A race rolls back operation/preparation
writes. Localnet uses v0; Devnet selects v1 when advertised by the wallet, with v0
fallback through the existing boundary.

## Signing, execution and finalization

The transaction derives the asset from `["core-asset", artwork address]`. The configured
registration authority signs, pays rent and becomes initial Core owner; physical
custody and authorship stay separate. Core creation and Registry binding execute
atomically. An existing asset or binding prevents a second successful mint.

Preparation neither creates the asset nor publishes the artwork, reconciles a receipt
or writes finalized ownership/history. The connected wallet must review and sign.
Receipt reconciliation remains scheduled separately. RPC/simulation does not reserve
chain state. The program rechecks live authorization and prerequisites; metadata
revision account relationships protect against a changed head. Reviewed condition and
custody versions are preparation checks; the existing mint instruction can observe
newer valid condition/held custody state at execution. They are not extra encoded
compare-and-swap arguments. Resimulate before signing when state may have changed.

Malformed inputs return 400, unauthenticated/unauthorized wallets 401/403, missing local
artworks 404, and integrity, eligibility, simulation or reservation conflicts 409.
Infrastructure errors are redacted. A successful response is private pending intent,
not proof of a finalized Core asset.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm program:test`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm format:check` and `pnpm codegen:check`. Synthetic tests cover real
generated instruction encoding, authoritative snapshot validation, private omission,
concurrent reservations, same-key transport refresh and stale document/artist guards.
API RPC/simulation tests are mocked; the existing offline Core lifecycle covers the
actual atomic mint and duplicate/rollback checks. No live signing or Devnet deployment
is performed by preparation or claimed by these tests.
