# Artwork verification preparation

`POST /verifier/artworks/:kathaId/operations/verification` prepares one unsigned
Registry authentication transaction. It requires a wallet session on the configured
localnet/Devnet cluster, the verifier allowlist, and the current finalized Registry
`verifierAuthority`. An admin wallet needs the verifier role separately.
The response is `unsignedOperationResponseSchema`, status 201, with `Cache-Control: no-store`.

## Request and manual review

The permanent ID path is validated and the query must be empty. The strict shared
`artworkVerificationRequestSchema` accepts only:

```json
{
  "idempotencyKey": "verify_artwork_1",
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "metadataVersionId": "11111111-1111-4111-8111-111111111111",
  "supportedTransactionVersions": [0, 1],
  "authenticityConfirmed": true
}
```

Use the current draft timestamp and latest approved metadata UUID. The verifier
must inspect the physical work, artist attribution and private authorship evidence
before confirming authenticity. Confirmation records a manual claim; neither this
API nor blockchain independently inspects the object. Never put private evidence,
contact details or inspection notes into this request or public Git.

Caller-provided authorities, RPC URLs, program/account addresses, artist identities,
hashes and instruction bytes are rejected. The existing registered authorship
commitment is the evidence hash authenticated by `verify_artwork`; this endpoint
does not introduce an additional verification-document hash or condition report.

## Eligibility and integrity

Authorization runs before draft, storage and artwork-account reads, and the
Registry authority is checked again before transaction preparation. The draft must
be unchanged and unpublished, with a verified artist and nonzero authorship evidence
hash. The selected latest metadata must be PREPARED or FINALIZED, strictly valid,
canonically serialized, SHA-256 checked and matched to the draft identity.
The local StorageProvider must return those exact approved public document bytes.
The service never fetches an arbitrary document URI over HTTP.

The Kit reader obtains configuration, artwork and verification PDAs with finalized
commitment and a ten-second deadline. It validates configuration and registered
artwork address, owner, size, discriminator, bump, category/ID and collection.
The API additionally compares artist UUID, optional creator wallet and creation
year against the local immutable attribution, and rejects a minted record.
The generated builder checks the authorship evidence hash against registration.
Any occupied verification PDA is rejected, regardless of owner. Existing finalized
verification records or VERIFY_ARTWORK operations also reject another preparation.
A finalized operation on another cluster does not establish verification here.
A finalized registration receipt in PostgreSQL is not required: the validated
finalized Registry artwork account is authoritative for registration.

Account reads follow Solana's [getAccountInfo contract](https://solana.com/docs/rpc/http/getaccountinfo).
Reads, simulation and local save are separate operations; they do not reserve chain
state. The Registry still enforces authorization and duplicate prevention during
actual execution. A transaction may fail if state changes after preparation.

## Persistence and signing

The server uses the existing Codama verification instruction, the connected verifier
as authority and fee payer, and one required wallet signer. Localnet uses v0; Devnet
selects v1 when the wallet declares support, otherwise v0. A localnet v1-only wallet
is rejected. Simulation must succeed before the private operation/preparation is saved.

The canonical idempotent intent binds the manual confirmation, draft timestamp,
immutable attribution, authorship evidence and selected metadata UUID/version/hash/URI,
plus actual instruction bytes/account roles. The metadata binding is off chain;
this instruction authenticates authorship and does not change metadata commitments.
Use a new idempotency key if the semantic review changes. Unchanged retries can
refresh the blockhash and preserve operation identity through the existing helper.

A save guard rechecks draft identity/timestamp, artist approval, latest metadata
status/identity/bytes/hash/URI and finalized verification eligibility under database
locks. A change during simulation returns 409 without inserting a new operation.
The existing metadata writer locks the parent artwork before inserting a revision;
future verification finalizers must follow the same parent-lock protocol. No RPC
or storage work holds these save locks.

Preparation changes only pending operation/preparation history. It never signs,
broadcasts, inserts a finalized verification/receipt, publishes the artwork, changes
custody or ownership, or mints an asset. The wallet reviews and signs; submission,
receipt reconciliation and indexer projections are separate workflows.

## Errors and checks

- 400: malformed path/body/query, absent/false confirmation, unsupported wallet versions.
- 401/403: missing session, role or current Registry authority, or cluster mismatch.
- 404: authorized request for a missing local artwork.
- 409: stale/ineligible draft, integrity failure, absent/invalid registered accounts,
  occupied verification, simulation rejection, or save/idempotency conflict.
- 500: unexpected storage/RPC/preparation failure; response and logs redact internals.

Run `pnpm test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm format:check` and `pnpm codegen:check`. Synthetic tests use real generated
instruction encoding and mocked RPC/simulation; PostgreSQL tests cover locked save
rechecks. They do not claim a live chain transaction was signed or submitted.
