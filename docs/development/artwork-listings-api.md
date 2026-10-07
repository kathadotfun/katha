# Artwork listing API

Listing preparation and cancellation are available for published, verified artwork
on the configured localnet or Devnet. These endpoints prepare unsigned transactions;
the connected wallet reviews, signs and submits them. The API never sends a payment
or changes physical custody. Prices use the configured six-decimal test token with
no monetary value.

## Finalized listing query

`GET /artworks/:kathaId/listing` is public and returns `Cache-Control: no-store`.
The artwork must pass the catalogue's publication boundary; hidden or unpublished
artwork returns `404`. The response includes `owner`, `asset`, `currentRevision`,
`observedSlot`, `chainTime`, and a nullable `listing` object. Amounts, revisions,
slots and timestamps are integer decimal strings. An unlisted asset returns
`listing: null` and revision `"0"`.

Registry, Marketplace, Core collection/asset, listing and Clock accounts are read
in one finalized batch, after resolving the collection from Registry configuration.
The reader pins the RPC genesis to the configured development network and validates
program owners, canonical PDAs, account discriminators, artwork/collection bindings,
configuration, version and listing history. Core's current owner is authoritative;
indexed ownership is used only by the existing publication gate.

`listing.active` means the record is ACTIVE, its seller is still the Core owner,
and the chain clock precedes expiry. An expired ACTIVE record remains `status:
"ACTIVE"` with `active: false` until an actual cancellation or expiry transaction.
This flag does not guarantee that inspection, custody or purchase checks will pass.
The on-chain program rechecks those rules when the transaction executes.

The official [Solana getMultipleAccounts documentation](https://solana.com/docs/rpc/http/getmultipleaccounts)
describes the batch's context slot, commitment and missing-account responses.

## Prepare a listing

`POST /artworks/:kathaId/operations/listing` requires a wallet-session bearer token
on the configured network. That wallet must be the current Core owner. The generated
builder additionally enforces primary seller, ledger revision, status, price,
expiry and current condition-head relationships. Full sale eligibility is simulated
and enforced by the Marketplace program.

```json
{
  "idempotencyKey": "owner-listing-001",
  "expectedRevision": "0",
  "price": "100000000",
  "expiresAt": "1800003600",
  "supportedTransactionVersions": [0, 1]
}
```

Use the revision from the finalized listing query and a future chain timestamp.
`100000000` represents 100 test tokens. The strict schema rejects numeric JSON
amounts, fractional/zero/overflowing prices, invalid expiry/revision/version values
and unknown fields. v0/v1 selection follows the existing wallet/cluster boundary.

A `201` response contains the unsigned wire transaction, exact message/request
hashes, operation/preparation IDs, sole required signer, blockhash lifetime,
simulation evidence, `currentRevision`, `nextRevision`, price and expiry.
The API independently encodes the transaction and compares every simulation
artifact field before saving. Canonical intent binds the artwork, wallet record,
network, kind, revision, price, expiry and all instruction account roles/data.
It is persisted internally, never returned with private artwork information.

Wallet-scoped idempotency and the publication guard run inside the existing
preparation transaction. Retrying an unchanged message returns its existing IDs;
a new blockhash can create another preparation for the same unchanged intent.
Reusing the key for different intent or a completed operation returns `409`.

## Prepare cancellation

`POST /artworks/:kathaId/operations/cancellation` uses the same session/publication
boundary and requires both the current Core owner and recorded listing seller.
Its strict body contains only `idempotencyKey`, `expectedRevision` and
`supportedTransactionVersions`. It returns a simulated unsigned cancellation with
the reviewed price/expiry and incremented revision. Cancellation remains possible
after expiry and does not require a fresh inspection. The program removes temporary
Core delegates and unlocks the asset atomically when the wallet submits it.

## Signing and receipts

Sign and submit the returned bytes using the existing wallet transaction flow.
Reconcile the exact signed preparation with the existing authenticated endpoint:
`POST /operations/:operationId/receipts`, using `preparationId` and
`transactionBase64`. Its allowlist now accepts CREATE_LISTING and CANCEL_LISTING
alongside Registry operations. The verifier binds the genuine wallet signature,
exact message and canonical instruction kind/program/accounts/data before lookup
of matching finalized RPC evidence. PURCHASE_ARTWORK remains outside this endpoint
until purchase integration. Unknown or failed receipts do not finalize the operation
or create listing, sale, ownership or custody history. Query finalized chain state
after confirmation; Marketplace history indexing is a separate step.

Missing publication gives `404`; missing session gives `401`; wrong owner/network
gives `403`; stale/ineligible requests, failed simulations, changed artifacts or
idempotency conflicts give `409`. Infrastructure failures return redacted `500`
responses, never a fabricated listing or successful transaction.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm db:test
pnpm program:test
pnpm codegen:check
```

Synthetic tests cover strict inputs, owner/network authorization, publication and
idempotency guards, finalized account/Clock decoding, forged accounts, expiry,
maximum read revisions, simulation mismatch, v0/v1 signed listing/cancellation
receipts and HTTP error redaction. Program regressions exercise actual Core locking,
unlocking and atomic settlement. No new migration, environment variable or private
wallet key is required. Purchase quotes, marketplace event indexing and collector
listing interfaces remain their own roadmap steps.
