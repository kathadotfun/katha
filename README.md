# Katha

Katha is a provenance and ownership platform for Nepal's cultural art. It connects
documented physical works to verifiable digital identities so collectors can
discover, own, preserve, and resell authentic pieces while the artist's authorship
remains permanent.

The first release focuses on Mandala, Paubha, and Thangka artworks. One documented
physical artwork maps to one permanent Katha ID and one Metaplex Core asset on
Solana Devnet.

## What the MVP will prove

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

Katha is under active development. This repository currently contains the public
product specification, architecture decisions, repository safeguards, a pinned
pnpm workspace, shared strict TypeScript presets, lint/format checks, task
orchestration, a minimal Next.js web scaffold, a bare Hono API service, an initial
shared TypeScript package, a Node-only database package boundary, a Solana client
package scaffold, empty Anchor Registry and Marketplace programs, and a
local PostgreSQL service. Artwork browsing and provenance, API behavior,
database behavior, and Solana client/program behavior remain planned until
implemented and tested.

The MVP targets local development and a reproducible Solana Devnet demonstration.
Hosted production deployment, mainnet, production payment economics, auctions,
fractional ownership, embedded wallets, and automated physical settlement are
outside the current scope.

## Project links

- Website domain: [katha.fun](https://katha.fun) — application deployment is planned.
- X: [@kathadotfun](https://x.com/kathadotfun)

## Documentation

- [MVP specification](docs/product/mvp.md)
- [Architecture overview](docs/architecture/overview.md)
- [Artwork lifecycle and state separation](docs/architecture/artwork-lifecycle.md)
- [Trust and lifecycle decision](docs/decisions/0001-trust-and-lifecycle.md)
- [Workspace setup](docs/development/workspace.md)
- [TypeScript configuration](docs/development/typescript.md)
- [Linting and formatting](docs/development/code-quality.md)
- [Workspace task orchestration](docs/development/turborepo.md)
- [Next.js web application](docs/development/nextjs.md)
- [Hono API service](docs/development/api.md)
- [Shared TypeScript package](docs/development/shared-package.md)
- [Database package boundary](docs/development/database-package.md)
- [Local PostgreSQL service](docs/development/local-services.md)
- [Foundation CI](docs/development/ci.md)
- [Solana package boundary](docs/development/solana-package.md)
- [Anchor program workspace](docs/development/anchor-workspace.md)

## Repository policy

Public history contains source code, tests with synthetic fixtures, manifests,
lockfiles, migrations, generated clients and IDLs, safe environment examples, and
project documentation. It excludes credentials, signing keys, real environment
files, private evidence, fulfillment details, local data, uploads, build output,
agent configuration, working notes, and source design files.

No license has been granted for this repository at this stage.
