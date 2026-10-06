# Artwork registration preparation

`POST /admin/artworks/:kathaId/operations/registration` returns 201 with
`unsignedOperationResponseSchema`. It prepares and simulates an unsigned Registry
registration transaction; the connected wallet approves, signs and submits it.
Preparation creates no registration receipt, finalized verification, ownership,
publication or Core asset. See [unsigned operation preparation](blockchain-operation-preparation.md).

## Request and authorization

Send JSON with a bearer session. The wallet must be on the server cluster, in the
admin allowlist and the fresh finalized Registry registrationAuthority. Authorization
runs before draft/storage/chain reads and again before building the operation.
The path must be a permanent Katha ID; query fields are rejected. The strict
`artworkRegistrationRequestSchema` accepts only these fields:

```json
{
  "idempotencyKey": "register-synthetic-1",
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "metadataVersionId": "11111111-1111-4111-8111-111111111111",
  "supportedTransactionVersions": [0]
}
```

The example is synthetic. Retain the same idempotency key when retrying an uncertain
preparation. Use the exact UTC millisecond timestamp from the latest draft create
or edit response, and the metadata version ID returned by approved document
preparation. UUID input is normalized to lowercase. Capabilities must contain one
or two distinct numbers from 0/1, based on the connected wallet. Localnet requires 0;
Devnet selects 1 when supported, otherwise 0. Legacy-only wallets are unsupported.
Do not supply a wallet, artwork UUID, artist ID, metadata/evidence hash, program,
RPC URL, accounts or raw instruction bytes; the server selects them.

## Eligibility and exact-byte binding

The server loads an unpublished draft, verified artist and latest metadata version.
The draft timestamp must still match. Its authorship evidence commitment must be
present and nonzero; the selected metadata UUID must identify the latest PREPARED
version with canonical public JSON, a hash and URI. A previously finalized
registration operation on the configured cluster is ineligible.

Strict metadata schema validation and canonical reserialization must reproduce
exactly the retained JSON bytes and SHA-256. Permanent ID, category, title, year,
artist UUID and immutable creator wallet must match the draft. The local provider
must return the same approved PUBLIC bytes through a hash-derived reference; the
service does not fetch arbitrary metadata URIs over HTTP. Artist payout wallet and
private biography/evidence documents are not used as public metadata inputs.

The Kit reader derives configuration/artwork PDAs and reads finalized accounts with
bounded deadlines. It validates Registry configuration ownership, size,
discriminator and PDA relationships. An occupied artwork address is rejected,
including an address occupied by an unexpected owner. See the official
[getAccountInfo contract](https://solana.com/docs/rpc/http/getaccountinfo).
The existing generated-client builder validates the registration authority and
constructs the permanent identity, artist attribution, category/year and authorship
commitment. No Core minting, custody or verification instruction is appended.

**Metadata is bound to the off-chain registration operation, not written by the
Registry registration instruction.** Expected hashes include both authorship and
metadata commitments. Private canonical intent also retains the selected metadata
UUID/version/hash/URI, draft timestamp, permanent identity and exact instruction.
On-chain metadata initialization/revision belongs to later lifecycle operations.

## Concurrency, retries and response

After successful unsigned simulation, the save transaction locks the wallet and
artwork, then rechecks the artist and latest metadata under shared locks. A changed
artist approval, draft identity/timestamp, newer selected metadata version or
registered state returns 409 before saving. Document writers serialize on the
parent artwork lock. No RPC or filesystem work holds these save locks.

Identical requests reuse the wallet/cluster/key operation. The same message reuses
its preparation ID; a fresh blockhash retains a new preparation alongside previous
messages. Changing the selected metadata or other committed input requires a new
key. Every retry repeats role, eligibility, local-byte and chain checks and simulation.
An unresolved receipt is not automatically retried; reconcile it before requesting
another logical operation. Chain PDA initialization also prevents two successful
registrations of one permanent identity.

The protected response contains operation/preparation IDs, permanent ID, kind,
cluster, request/message hashes, unsigned base64 transaction, transaction version,
fee payer, required signer, blockhash, expiry and simulation slot/units as decimal
strings. It omits canonical private intent, storage paths, private content and RPC
logs. Cache-Control is no-store. Public discovery/details retain their existing
publication gate. [Receipt reconciliation](operation-receipts-api.md) validates finalized outcomes;
submitting or preparing bytes does not mark a draft registered locally. The
[admin workflow](artwork-registration-web.md) also exposes a protected canonical
document/receipt read for unpublished artworks and explicit wallet approval.

## Errors and verification

- 400 INVALID_REQUEST: invalid body/path/query or localnet wallet without v0.
- 401 UNAUTHENTICATED /403 FORBIDDEN: missing session, wrong cluster/allowlist or
  Registry authority; changed authority on retry.
- 404 NOT_FOUND: no matching draft.
- 409 CONFLICT: stale/ineligible draft, wrong metadata, missing/tampered approved
  bytes, occupied/invalid chain accounts, failed simulation or conflicting operation.
- 500 INTERNAL_ERROR: unavailable storage/RPC/database; raw details remain redacted.

Run `pnpm test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm format:check` and `pnpm codegen:check`. Synthetic tests exercise the actual
Hono route and generated registration builder, protected projections, authorization
before side effects, wrong authorities/accounts, occupied PDAs, metadata integrity,
strict requests and simulation failures. Disposable PostgreSQL tests verify that
metadata and artist approval changes between load/save leave no new operation.
No new dependency, migration, program instruction or signing material is required.
