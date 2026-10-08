# Artwork purchase quotes and preparation

These endpoints authenticate a collector on configured localnet/Devnet, quote an
active published artwork and prepare its unsigned Marketplace purchase. Payment
uses the six-decimal **Katha test token (no monetary value)**. Only the wallet
approves, signs and submits the transaction. Physical delivery remains a separate
manual workflow; no quote, preparation or receipt changes physical custody.

The [purchase quote screen](purchase-quotes-web.md) displays these authenticated
terms without automatically preparing or signing a transaction. The explicit
[buyer purchase flow](purchase-web.md) prepares reviewed terms and requires wallet
approval before submission.

## Quote

`POST /artworks/:kathaId/purchase-quote` requires the existing wallet-session bearer
token and a strict JSON body:

```json
{ "supportedTransactionVersions": [0, 1] }
```

The artwork must pass the public catalogue's publication gate. The buyer comes
from the session, and price, revision, mint, seller, artist payout and treasury
come from validated finalized chain accounts. The API rejects self-purchase and
buyers sharing the artist or treasury payout wallet. Clients cannot select an
amount, fee, recipient, mint, buyer or custody state.

The purchase reader includes immutable sale terms in the same finalized account
batch as Registry configuration/artwork, Marketplace configuration/listing, Core
collection/asset, condition head and Clock. It pins the development network genesis;
the generated builder validates account owners/PDAs/collection, current ownership,
active status, revision, price, expiry, immutable payout and condition commitment.
Simulation additionally checks verification, custody, inspection validity, Core
locking/delegates, mint and canonical token accounts, balances and atomic transfer.
Missing token accounts or insufficient funds therefore prevent a successful quote.
The operator must initialize Marketplace configuration and sale terms and fund the
buyer's canonical test-token account before demonstrating purchases.

A successful `200` response contains the buyer-bound terms and `quoteHash`:

- permanent Katha ID, cluster, Core asset, listing, revision, price and expiry;
- seller, immutable artist payout, treasury, primary/secondary sale kind;
- clearly labeled mint, six decimals and development-only payment type;
- configured commission/royalty, exact role amounts and merged wallet recipients;
- condition report/hash/version and listing's custody revision;
- finalized observed slot/chain timestamp and successful simulation evidence.

Amounts, revisions, slots and timestamps are integer decimal strings. For a
100,000,000-unit primary sale with the simulation defaults, the artist receives
97,500,000 and treasury 2,500,000. For secondary sale, the seller receives
92,500,000, artist 5,000,000 and treasury 2,500,000. Each basis-point deduction floors
independently. Remaining units go to artist (primary) or seller (secondary).
Matching recipients merge, while role amounts stay separate and sum exactly to
price. The preview mirrors the checked [Rust distribution](marketplace-distributions.md);
only the program executes settlement. Network SOL fees are additional and reviewed
through the wallet's transaction flow, not included in the test-token distribution.

`quoteHash` is SHA-256 over canonical semantic terms, including buyer, cluster,
identities, mint, price/revision/expiry, recipients/fees/distribution and condition/
custody commitments. Observed slot, clock and simulation evidence are excluded
so a new block alone does not invalidate unchanged terms. The quote is a preview
of current eligibility, not a reservation or proof of completed payment.
Listing/inspection expiry and all eligibility rules remain checked on chain.
Quotes do not create operation/preparation rows or submit a transaction.

## Prepare the reviewed purchase

`POST /artworks/:kathaId/operations/purchase` accepts only:

```json
{
  "supportedTransactionVersions": [0, 1],
  "idempotencyKey": "buyer-purchase-001",
  "quoteHash": "replace-with-the-64-character-lowercase-hash-returned-by-the-quote"
}
```

The hash example is a placeholder, not a valid request. The service reauthenticates,
rechecks publication, rereads finalized state and recalculates semantic terms.
Changed terms or another buyer's hash return `409` before preparation simulation.
It then invokes the [Devnet PaymentProvider](devnet-payment-provider.md) and simulates
one generated purchase with exact reviewed revision/price and configured mint.
The provider compares independently encoded unsigned bytes/hash/version/payer/
lifetime/sole buyer signer to the simulation artifact. The API checks returned
buyer/session/mint/quote bindings and decoded purchase instruction before saving.
No second token transfer is prepared.

The `201` response contains the existing unsigned-operation fields, kind
`PURCHASE_ARTWORK`, operation/preparation IDs, `nextRevision`, and the complete
validated quote. Persisted canonical intent binds the buyer's wallet record,
network, Katha ID, quote hash/terms, condition hash and all instruction accounts,
roles and data. The public response omits internal canonical intent and private
evidence. Persistence reuses wallet-scoped idempotency and the transactional
publication guard. Retry unchanged intent with the same key; changed intent or a
completed operation conflicts. A fresh blockhash can append a preparation for the
same unchanged intent.

## Sign and reconcile

The connected buyer signs the selected unsigned wire and submits it. Reconcile
through `POST /operations/:operationId/receipts` with that `preparationId` and exact
signed `transactionBase64`. The receipt allowlist now includes PURCHASE_ARTWORK.
Canonical wire, genuine buyer signature, exact prepared message and generated
Marketplace instruction kind/program/accounts/data must match stored intent.
Only a matching successful finalized RPC transaction finalizes the operation.
Failed/unknown attempts never create sale or ownership history. Marketplace sale
indexing is implemented separately; Core remains authoritative for current owner.

All purchase responses use `Cache-Control: no-store`. Strict body/path/query checks
reject unknown fields. Missing publication gives `404`, invalid session `401`,
wrong network or buyer alias `403`, stale/ineligible/simulation/idempotency mismatch
`409`. Infrastructure outages return redacted `500` responses. Never infer success
from a quote, simulation, wallet approval or submitted signature alone.

The official [simulation RPC documentation](https://solana.com/docs/rpc/http/simulatetransaction)
explains unsigned simulation without broadcast and transaction error evidence;
[account batching](https://solana.com/docs/rpc/http/getmultipleaccounts) provides the
finalized context and account ordering. Simulation is not a reservation: purchase
rechecks state atomically when executed.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm db:test
pnpm program:test
pnpm codegen:check
```

Synthetic tests cover strict contracts, buyer/network/recipient aliases, publication,
quote stability and changed intent, generated purchase bindings, failed simulation,
unsigned persistence, primary/secondary u64 rounding and recipient merging, v0/v1
signed receipts and safe HTTP outages. Disposable PostgreSQL tests verify purchase
idempotency and rejection of hidden artwork. Program regressions cover actual
settlement, stale listings/inspections, wrong mints, insufficient funds, races and
rollback. No new dependency, migration, environment variable, program ABI or real
wallet signing key is required.
