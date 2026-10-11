# Listing cancellation and expiry recovery controls

Connect and sign in as the current Core owner and recorded listing seller. Open
`/collection` and choose **Manage this listing**, or open
`/collection/{kathaId}/list` directly. The page reads finalized listing state,
revision, price and expiry independently of indexed holdings.

For an ACTIVE ledger, **Cancel listing** prepares seller cancellation. If observed
chain time has reached the inclusive expiry boundary, the label becomes **Release
expired listing**. Expiry alone does not unlock an asset: cleanup needs a confirmed
transaction. These two controls use the existing seller cancellation API and
`cancel_listing` instruction, which work before or after expiry. The resulting
status is CANCELLED. The program's permissionless `expire_listing` instruction
remains available through its transaction builder; this UI does not expose a
permissionless expiry API or imply that another wallet can cancel the offer.

## Review and confirmation

Preparation POSTs only an idempotency key, observed revision and supported
transaction versions to `/artworks/{kathaId}/operations/cancellation`. The session
stays inside the existing bearer boundary. Price and expiry shown for review are
the ledger's historical terms, not a new token payment. Network fees and account
rent may apply. The generated cancellation instruction is decoded and checked for
exact artwork/asset/listing/configuration PDAs, collection, actor, account roles,
programs, revision and response terms before simulation.

Approval remains explicit. The transaction lifecycle simulates again, rechecks
wallet identity and lifetime, verifies the wallet's signature over identical
reviewed bytes, retains the signed attempt, submits with preflight and reconciles
finalized execution. Rejected approval or failed execution does not report release.
Unknown confirmation retains its signature and requires **Check this transaction
again**; it prevents preparing a replacement through this form.

The UI reports completion only after a finalized receipt and a matching finalized
CANCELLED ledger observation with the expected incremented revision, same asset,
seller, price and expiry. It then refreshes listing state automatically. A read
outage or conflicting revision cannot pretend that release completed. Manual
**Refresh listing state** also reads another finalized observation, including
cleanup performed elsewhere. After a confirmed terminal record, another listing
can be prepared with its current revision and fresh eligibility checks.

The [program's atomic cleanup](marketplace-cancellation.md) thaws the asset and
revokes temporary Marketplace delegates. Owner-managed plugin records can remain
attached; revocation returns authority to its default role, as described in
[Metaplex's revocation documentation](https://www.metaplex.com/docs/smart-contracts/core/plugins/delegating-and-revoking-plugins).
The UI reads the resulting ledger and Core owner through the public API; it does
not independently inspect plugin bytes. Authorship, Core ownership and physical
custody stay separate. Release does not require a new inspection or attest a
physical move. Relisting still rechecks current sale eligibility.

Wallet/session changes abort pending reads/preparation and discard late responses.
Only one preparation runs at a time. After uncertain preparation, inspect retained
transaction status and refresh before retrying. **Cancel**
only discards an unsigned browser review; it does not cancel an on-chain listing.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:collection
pnpm format:check
pnpm codegen:check
```

Units cover changed actors/revisions/programs/collections/response terms, private
HTTP bodies, nonowners/wrong sellers, inclusive expired recovery, uncertain
signatures, concurrent preparation, late responses after sign-out, matching
terminal observations, and actual wallet adapter signing with an ephemeral
synthetic identity. The shared browser suite checks active cancellation, rejected
wallet approval without false success, expired recovery review, externally
completed cleanup followed by refresh, relisting controls, axe accessibility and
overflow at 375, 768 and 1280px. Browser API/RPC responses are synthetic. Existing
program tests cover actual Core cleanup; no program change is introduced here.
Live wallet approvals and the Devnet demonstration remain manual.
