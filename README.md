# Katha

Katha is a provenance and ownership platform for Nepal's cultural art. It connects
documented physical works to verifiable digital identities so collectors can
discover, own, preserve, and resell authentic pieces while the artist's authorship
remains permanent.

The first release focuses on Mandala, Paubha, and Thangka artworks. One documented
physical artwork maps to one permanent Katha ID and one Metaplex Core asset on
Solana Devnet.

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

- [MVP specification](docs/product/mvp.md)
- [Architecture and trust boundaries](docs/architecture/overview.md)
- [Artwork lifecycle](docs/architecture/artwork-lifecycle.md)
- [Fresh local setup](docs/development/getting-started.md)
- [Verification results and remaining acceptance](docs/development/mvp-verification.md)
- [Public Devnet network snapshot](docs/development/devnet-network.md)
- [Two-wallet and NFC demonstration](docs/development/devnet-demo.md) — manual checks pending
- [All development, API, program and test guides](docs/development/README.md)

## Repository policy

Public history contains source code, tests with synthetic fixtures, manifests,
lockfiles, migrations, generated clients and IDLs, safe environment examples, and
project documentation. It excludes credentials, signing keys, real environment
files, private evidence, fulfillment details, local data, uploads, build output,
agent configuration, working notes, and source design files.

No license has been granted for this repository at this stage.
