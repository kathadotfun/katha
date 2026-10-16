# Katha

**Tokenizing Nepali art. Katha is a physical Nepali art marketplace bringing
verified artworks onchain as real-world collectibles.**

Nepali paintings are valuable but illiquid. They are hard to verify and hard to
resell, and their history is easily lost between owners. Katha makes each verified
Mandala, Paubha, and Thangka a real-world asset (RWA) on Solana. One physical
painting is backed 1:1 by one Metaplex Core asset, has one permanent Katha ID, and
carries a public record of its artist, inspections, custody, and every sale.

## Why RWA

An RWA is a token whose value follows a real item, so it is only as good as the
link between the two ([ethereum.org overview](https://ethereum.org/real-world-assets/)).
Katha keeps that link explicit and public:

| Layer        | What it is                                                                     |
| ------------ | ------------------------------------------------------------------------------ |
| The painting | Authenticated, condition-graded, in recorded physical custody                  |
| The anchor   | Permanent Katha ID plus an NFC tag that opens the artwork's public record      |
| The token    | Metaplex Core asset in the owner's wallet; metadata and reports hash-committed |

The holder gets the onchain asset, can request delivery of the painting or leave
it in Katha's care, and can resell it onchain. The artist's
attribution never changes, and the artist receives a royalty on resales settled
through Katha.

A token transfer alone does not move a painting. Katha separates authorship,
digital ownership, physical custody, verification, and listing status, and records
each change separately. A basic NFC tag can be copied, so it serves as a discovery
anchor rather than proof. The model is similar to an asset-bound token
([EIP-6956](https://eips.ethereum.org/EIPS/eip-6956)), where control of the physical
item is attested by a trusted verifier. Formal holder terms linking token ownership
to delivery rights are required before any mainnet launch.

## Collected like graded cards

Tokenized trading cards showed that physical collectibles trade well onchain. A
card is graded, vaulted, traded as a token, and redeemed for the real item. On
Solana, Collector Crypt reports more than 130,000 tokenized cards and $1.6 billion
in volume ([Solana](https://solana.com/news/tokenized-cards-and-physical-collectibles)).
Katha applies the same collecting loop of discovering, owning, caring for, and
trading to one-of-one paintings:

| Graded card RWA    | Katha painting                                   |
| ------------------ | ------------------------------------------------ |
| Mass-printed card  | One-of-one handmade painting                     |
| Grading score      | Dated, hash-committed condition inspection       |
| Slab serial number | Permanent Katha ID and NFC tag                   |
| Vault              | Katha's care or the owner's, recorded onchain    |
| Redeem the card    | Request delivery; the asset stays in your wallet |
| No creator share   | Artist credited forever and paid on resale       |

Each painting still needs individual inspection and delivery coordination. Katha
records those steps instead of assuming them.

## Onchain design

- **Metaplex Core asset** per artwork, minted into a Katha collection and bound to
  the Registry in the same transaction.
- **Anchor programs:** a Registry for artists, artworks, verification, condition,
  and custody attestations, and a Marketplace for listings and purchases.
- **Atomic settlement:** one instruction transfers the Core asset and settles every
  payout in an SPL token: artist proceeds and platform commission on a primary
  sale, and seller proceeds, artist royalty, and commission on a resale.
- **SHA-256 commitments** anchor canonical metadata and condition reports. Media
  and private evidence stay off chain.
- **Condition-checked resale:** every purchase rechecks condition and custody, and
  a collector-held work needs a current inspection bound to its owner and custody
  before it can be listed.
- **Indexed provenance:** finalized activity is indexed into PostgreSQL with
  replay, backfill, and visible gaps.

The fee defaults are a 10% platform commission on the first sale, a 2.5% platform
commission on resale, and a 5% artist resale royalty. An authorized operator can
change fees for future listings; active listings retain their reviewed rates.
Inspection validity defaults to 30 days. These remain development settings;
the recorded Devnet deployment predates the editable fee schedule.

## Market context

Global art sales were about $59.6 billion in 2025
([Art Basel and UBS](https://www.artbasel.com/stories/the-art-basel-and-ubs-global-art-market-report-2026)).
Solana's tokenized RWA value reached a reported record of about $3.4 billion in
July 2026 ([Crypto Briefing](https://cryptobriefing.com/solana-rwa-ecosystem-all-time-high/)).

## Artwork lifecycle

The Devnet MVP follows one complete artwork lifecycle:

```text
artist and artwork documentation
  -> Katha authentication and condition inspection
  -> permanent Katha ID and Core asset
  -> NFC discovery
  -> primary purchase by Wallet A
  -> condition-aware resale
  -> purchase by Wallet B
  -> preserved authorship, custody, and provenance
```

Katha records claims made through a physical verification process. Blockchain
records make those claims and later ownership changes tamper-evident; they do not
independently prove that a physical artwork is authentic. NFC is a stable discovery
bridge to the artwork record, not proof by itself.

## Project status

Both programs and their singleton configurations are initialized on Solana Devnet,
with a Core collection and a six-decimal test payment mint. Public addresses,
finalized receipts and deployed binary hashes are recorded in the
[verified Devnet configuration](docs/development/devnet-network.md).
The real-artwork, two-wallet and NFC demonstration remains to be verified.

The software implements artwork documentation, authorized verification and
condition inspections, custody coordination, atomic Core minting and metadata
revisions, NFC resolution, fixed-price test-token purchases, and inspected resale.
The web application includes public browsing, administration and collector flows.
Finalized activity is indexed into PostgreSQL with replay, backfill and visible gaps.

Automated local suites exercise synthetic artwork onboarding, primary collecting,
both custody/resale situations, authorization and recovery failures. They are
separate from the pending real-artwork Devnet demonstration. See the
[verification and acceptance record](docs/development/mvp-verification.md) for
current check results, evidence boundaries and remaining checkpoints.

The MVP targets local development and a reproducible Solana Devnet demonstration.
Hosted production deployment, mainnet, production payment economics, auctions,
fractional ownership, embedded wallets, and automated physical settlement are
outside the current scope.

## Project links

- Website domain: [katha.fun](https://katha.fun) — application deployment is planned.
- X: [@kathadotfun](https://x.com/kathadotfun)

## Documentation

- [Fresh local setup](docs/development/getting-started.md)
- [Developer guide and verification commands](docs/development/README.md)
- [Operations, recovery and NFC](docs/development/operations.md)
- [MVP specification](docs/product/mvp.md)
- [Architecture and trust boundaries](docs/architecture/overview.md)
- [Two-wallet and NFC demonstration](docs/development/devnet-demo.md) — manual checks pending
- [Verification record](docs/development/mvp-verification.md) and [Devnet network snapshot](docs/development/devnet-network.md)

Exact API contracts, configuration and behavior live in source and tests. Update
the guides when setup, usage, operations or design assumptions change; internal
implementation changes do not need a separate documentation update.

## Repository policy

Public history contains source code, tests with synthetic fixtures, manifests,
lockfiles, migrations, generated clients and IDLs, safe environment examples, and
project documentation. It excludes credentials, signing keys, real environment
files, private evidence, fulfillment details, local data, uploads, build output,
agent configuration, working notes, and source design files.

No license has been granted for this repository at this stage.
