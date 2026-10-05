# Pending blockchain operations and receipts

`@katha/db` exports `blockchainOperations` and `transactionReceipts`, their enums,
and inferred record types. Forward migration `0006_blockchain_operations.sql`
creates the tables and reviewed custom lifecycle guards. Apply it through the
[database migration workflow](database-package.md).

## Immutable expectations

Each operation belongs to an artwork, requesting wallet and LOCALNET/DEVNET
cluster. It stores the operation kind, idempotency key, request hash, expected
program address, ordered account addresses and ordered document/evidence hashes.
Registry and Marketplace artwork operation kinds are available in the schema.
The preparation service currently supports Registry kinds only; signing and marketplace behavior remain separate work.
[Receipt reconciliation](operation-receipts-api.md) now supports prepared Registry operations.

An idempotency key is unique within a wallet and cluster, across operation kinds.
Keys contain 1–128 ASCII letters, digits, underscores or hyphens. A retry must look
up that scoped key and compare the immutable request hash and expected inputs.
Return the existing operation for an identical request; reject conflicting input.
The unique constraint handles races; the preparation store serializes retries
and implements request comparison after service authorization. A new key is necessary for a new
logical operation. Database rows and keys cannot be deleted or rewritten.

Account arrays contain 1–64 base58-shaped addresses; hash arrays contain 0–32
lowercase SHA-256 digests. Preserve ordering and define its meaning in each future
operation builder. These are bounded persistence fields: the API must decode
addresses, hash canonical request/document bytes, verify the configured program,
PDA relationships and actual transaction accounts. A syntactically valid row
alone does not prove correct chain behavior. Store commitments, not private
artist evidence, contact details or signing material.

## Receipt attempts and status

An operation starts `PREPARED`, without receipts. Each verified signed attempt creates
an `UNKNOWN` receipt containing its cluster and exact transaction-message hash.
Signatures are unique per cluster, so one transaction cannot be attached to two
operations. A composite foreign key binds receipt cluster to operation cluster.
One operation can retain multiple signed attempts, including previous failures.
Receipt identity fields never change and receipts cannot be deleted.

| Operation status | Meaning                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PREPARED`       | No signature receipt has been recorded. It does not mean the transaction was broadcast.                                  |
| `UNKNOWN`        | At least one attempt has an unresolved outcome, and none has finalized successfully.                                     |
| `FAILED`         | Every recorded attempt is conclusively failed. A fresh signed attempt can return it to `UNKNOWN`.                        |
| `FINALIZED`      | Exactly one receipt records validated successful finalization. This takes precedence over unresolved or failed attempts. |

A receipt may remain `UNKNOWN` while observations are refreshed, or transition
once to `FAILED` or `FINALIZED`. Terminal receipts are immutable. `FAILED` requires
a bounded uppercase failure code, not a raw RPC error containing sensitive data.
`FINALIZED` requires a nonnegative bigint slot, finite chain timestamp and ordered
finalization time. JSON consumers must serialize slots as integer decimal strings.
Creation, observation and operation-update times come from the database clock.

A network timeout or temporary missing signature remains `UNKNOWN`. Classify an
attempt as `FAILED` only after reconciliation has conclusive failure evidence.
The current endpoint requires a matching finalized transaction with an execution
error; it does not infer expiry. The schema has no RPC connection and cannot verify
such evidence itself.

## Reconciliation and recovery

Receipt mutations acquire a lock on the parent operation before checking lifecycle
rules. After the mutation, a trigger derives the operation status from all receipts
in the same transaction. Competing successful finalizations serialize; a second
successful receipt is rejected. PostgreSQL documents the
[row-lock behavior](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS).
Manual operation-status changes that disagree with its receipts are rejected.
After successful finalization, new attempts are rejected, while an older unresolved
attempt may still be marked failed without erasing the successful outcome.

Receipt reconciliation validates the finalized transaction's success,
signer, cluster, program/instruction, accounts and commitments against the stored
expectations before updating the receipt. Receipt and aggregate operation status update
in one transaction; domain projection writes belong to indexing. A failed transaction or failed database write must not
create provenance. The tests verify that rolling back receipt reconciliation also
rolls back the derived operation status. These tables themselves never create
verification, condition, custody or ownership history.

Persist a signature before or alongside its submission flow so a restart can
reconcile it; submitting it does not prove success. Keep retry attempts distinct,
retain the original immutable request, and do not retry an unresolved operation
blindly. Logical idempotency cannot prevent double execution of different signed
transactions on chain; future preparation must honor program-level identity,
revision and sale guards. Authorization and unsigned simulation are implemented by the preparation
service. Registry preparation endpoints and signed receipt validation now exist; wallet
submission and event indexing remain separate workflows.

Wallet and artwork references use restrictive deletion. A wallet referenced by an
operation cannot be removed using the earlier wallet cleanup path; revoke its
sessions without deleting that retained wallet identity.

## Verification

Run `pnpm db:test` with Docker running. Its disposable synthetic database checks
migration replay, idempotency races, immutable expectations, malformed input,
missing references, cluster/signature binding, incomplete outcomes, failure and
retry, competing finalizations, bigint precision, rollback, retained history and
independence from provenance. Preserve custom SQL guards alongside the generated
snapshot/journal; generation alone does not describe triggers.

## Preparation service

The internal [unsigned-operation service](blockchain-operation-preparation.md)
now persists exact canonical intents and immutable simulated message preparations.
Migration0010 retains refreshed blockhash messages separately from eventual
transaction receipts; no generic preparation HTTP route is added. The receipt endpoint validates
a signed copy of one retained preparation before accepting the derived signature.
