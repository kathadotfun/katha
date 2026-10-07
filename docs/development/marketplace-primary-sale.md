# Complete local primary sale

The primary-sale integration runs real Registry, Marketplace, Core and classic
SPL Token instructions in LiteSVM. It uses the pinned program harness and the
unsigned marketplace builders, with temporary synthetic signers. Follow
[local setup](getting-started.md) and [program testing](program-testing.md), then run:

```bash
pnpm program:test
```

The runner builds the programs, checks the pinned Core binary and includes
`packages/solana/tests/marketplace-primary.test.ts`. Its single lifecycle case
checks every stage below; other harness files cover additional failure modes.

## Journey and evidence

The fixture registers a fictional Paubha, verifies its authorship commitment,
records metadata and an initial condition inspection, attests Katha-held custody,
and mints its one Registry-bound Core asset. Artist, initial owner/registration
authority, verifier, custodian, platform, buyer and treasury use separate identities.
It also provisions the six-decimal test mint and associated token accounts.

| Stage                        | Assertions                                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before sale                  | Permanent Katha ID, artist identity, creator wallet, verification, metadata hash/version, inspection hash and Katha-held custody are present; the seller owns the bound Core asset.                    |
| Configure payouts            | An outsider cannot initialize artist sale terms; the authorized platform sets the immutable artist payout wallet.                                                                                      |
| List through builder         | The artist cannot list an asset owned by another wallet. The seller's instruction creates the primary listing and temporary delegates; Core ownership stays with the seller while the asset is frozen. |
| Reject unauthorized spending | A different buyer cannot spend the quoted buyer's token account. Listing, Core asset, token balances and prior Registry records remain unchanged.                                                      |
| Purchase through builder     | Only the buyer signs the purchase instruction; a separate platform wallet pays network fees. The seller does not sign the purchase.                                                                    |
| Check settlement             | A 100-token price debits exactly 100 tokens from the buyer, credits 97.5 to the artist and 2.5 to the treasury, and credits zero to the seller. Destination credits equal the source debit.            |
| Check ownership              | Core now reports the buyer as owner, the asset is unfrozen and both temporary delegate authorities have returned to the owner. The listing records one completed primary sale at revision two.         |
| Check provenance             | Exactly one decoded `ArtworkPurchased` event agrees with the price, recipients, distributions, identities, revision, condition commitment, custody revision and chain timestamp.                       |
| Reject replay                | Repeating the purchase with a fresh blockhash fails without another payment, ownership change or listing revision.                                                                                     |

The test compares complete encoded accounts before and after listing, purchase
and rejected operations. Artist attribution, artwork identity, verification,
metadata history, condition history, custody head/transition and collection remain
unchanged. A second artwork and its Core asset also remain unchanged, and the
artist's sale terms remain immutable. Digital purchase therefore does not record
a physical handover or a new inspection.

## Boundary

These are development simulation settings: a six-decimal test token and a
250-basis-point primary commission. Native transaction fees are separate from
token proceeds. No real wallet, private evidence, physical delivery, external
transaction or hosted service is used. This verifies the program/client path;
Marketplace API, indexing and collector browser integration follow separately.
The local test does not prove Devnet finalization or a completed physical inspection.

See [transaction preparation](marketplace-transactions.md),
[atomic purchase](marketplace-purchase.md) and
[settlement failure coverage](marketplace-failure-tests.md) for related checks.
