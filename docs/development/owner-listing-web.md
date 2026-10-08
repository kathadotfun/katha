# Owner listing form

Sign in through `/account`, open `/collection`, and choose **Offer this artwork
for sale**. The route `/collection/{kathaId}/list` also accepts a permanent Katha
ID directly. It requires the connected, authenticated wallet to match the
finalized Core owner. Search indexing is disabled; session tokens stay in memory
and authorized requests use the existing private bearer boundary.

## Price and expiry

Enter a positive plain decimal test-token amount with at most six decimal places.
`12.500001` becomes `12500001` integer base units. Conversion uses BigInt and the
shared positive u64 bound; exponents, separators, signs, leading zeros, excess
precision and overflow are rejected. These tokens have no real-money value.
Expiry uses your browser's local time and becomes an integer Unix timestamp.
Malformed, normalized invalid calendar dates and past dates are rejected. The API
and program enforce chain-time eligibility and listing revisions again.

## Preparation and wallet approval

1. Refresh finalized listing state and the artwork's bound Core asset/collection.
2. Enter price and expiry. Preparation sends those exact terms, the observed listing
   revision, supported transaction versions and a new idempotency key to the
   [listing API](artwork-listings-api.md). It never signs automatically.
3. Review price in base units, UTC expiry, network, fee payer, estimated network fee,
   affected accounts and message commitment. The browser decodes the generated
   Marketplace instruction and checks exact terms, program addresses, artwork and
   asset PDAs, collection, account order/permissions and seller.
4. Approve explicitly. The existing transaction lifecycle simulates again, asks
   the wallet to sign the exact validated bytes, reconciles the attempt, submits
   with preflight and waits for a finalized receipt. Signed-byte or signature
   modifications fail validation. A matching active finalized listing must also
   be observed before the UI reports completion.

The condition report is a read-only instruction account. Its current report,
verification, ownership, custody and inspection eligibility are checked by API
preparation and program execution/simulation; the form does not independently
certify physical condition. Collector-held resale requires approval scoped to
current owner/custody and inspection validity. Katha-held sales follow the program's
applicable condition rules. Physical inspection remains manual. Listing locks the
Core asset using temporary delegates; authorship, digital ownership and physical
custody remain separate.

An ACTIVE record needs release even if its expiry has passed. Refresh before
another preparation, especially after uncertain responses. Check a retained
signature before retrying; unknown confirmation is not success. Wallet/session
changes discard stale reads and prepared authority. The same route also provides
[seller cancellation and expiry recovery](listing-management-web.md) controls.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:collection
pnpm format:check
```

Unit tests include exact amount bounds, date validation, changed instruction terms
and accounts, nonowner/active-listing rejection, private transport, and a complete
simulation/explicit approval/signing/receipt/indexing lifecycle using an ephemeral
synthetic signer. The shared collector browser harness checks invalid input,
preparation, review without automatic signing, cancellation of unsigned review,
accessibility and overflow at 375, 768 and 1280px. API/RPC responses are synthetic;
this harness does not prove live chain execution. Real wallet approval and the
Devnet demonstration remain manual.

## Current inspection approval

The owner screen reads the private resale inspection boundary before enabling a
new listing and again immediately before preparation. Missing/stale/expired
approval blocks creation. Cancellation and expiry recovery remain available when
approval reads fail. Collector-held secondary sales require a finalized PRE_RESALE
report matching the current owner/custody and configured validity. See the
[inspection request and approval guide](resale-inspection-web.md).
