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
orchestration, a minimal Next.js web scaffold, a Hono API service, an initial
shared TypeScript package, a Node-only Drizzle database package, a Solana client
package, an Anchor Registry, an empty Marketplace program, and a local
PostgreSQL service. The Solana package includes Kit clients, a Core adapter,
generated program clients, unsigned transaction builders, and simulation.
Local tests cover Registry configuration, artwork registration and verification,
condition and custody attestations, versioned metadata, Core minting, and atomic
post-mint metadata updates. The complete Registry journey also runs through
offline Surfpool RPC, checking historical commitments and one bound Core asset.
The database package now provides explicit PostgreSQL connections and forward
migration commands, artist profiles, and artwork records with concurrent permanent
Katha ID allocation and immutable attribution, ordered media with explicit
visibility, separate material records, and preserved metadata, verification and
condition documents with explicit preparation and finalization states, plus
manual custody history and separate private fulfillment requests, plus unique
wallet records, single-use challenges and hashed session persistence, and
idempotent blockchain operations with retained transaction attempts. Database
read models now preserve indexed events, gap-aware checkpoints, ownership,
listings and sale distributions; chain ingestion remains planned. Fictional draft
fixtures and fresh-database constraint tests complete the database foundation.
The API now validates server settings before listening and provides an explicit
public configuration allowlist, fixed domain error responses, server-generated
request IDs, structured logs that omit private request data, separate liveness and
database readiness endpoints, bounded HTTP/database shutdown, shared REST contracts,
restricted CORS, request-size limits, pagination validation, and signed wallet
challenges with replay-protected bearer sessions, server-configured admin/verifier
guards, finalized Registry authority checks, and authorized artist creation and
manual profile verification, public verified-artist queries with safe field projections,
and admin artwork draft creation and editing with retry-safe permanent IDs,
protected attribution, optimistic concurrency checks, and public artwork discovery
with category filtering and a publication gate, plus public artwork details with
finalized attestation summaries and explicit indexed ownership/freshness. A local
storage provider validates content-addressed bytes with separate public/private
namespaces. Authorized document preparation now preserves canonical public metadata
and private condition bytes; media upload workflows remain planned. Internal
unsigned-operation helpers now authorize and simulate exact wallet transactions,
preserving idempotent intents and immutable preparation history. The admin registration
preparation endpoint now binds approved metadata and immutable identity. A verifier
endpoint prepares artwork authentication after explicit manual confirmation and
validated registered attribution. Condition preparation binds exact private report
bytes and current chain version, including minted owner/custody scope; remaining
HTTP operation routes are planned. Custody preparation and private owner fulfillment
requests now support separately authorized manual coordination without claiming
finalized physical delivery. Mint preparation now verifies committed metadata,
initial inspection and held custody, and reserves one idempotent unsigned Core mint
intent per artwork and cluster. Metadata commitment preparation now supports
initial, pre-mint and atomic post-mint Registry/Core revisions from immutable stored
documents.
Remaining API behavior and Marketplace
business instructions remain planned.

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
- [Fresh-checkout local setup](docs/development/getting-started.md)
- [Workspace setup](docs/development/workspace.md)
- [TypeScript configuration](docs/development/typescript.md)
- [Linting and formatting](docs/development/code-quality.md)
- [Workspace task orchestration](docs/development/turborepo.md)
- [Next.js web application](docs/development/nextjs.md)
- [Hono API service](docs/development/api.md)
- [Content API contracts and privacy boundaries](docs/development/content-api-contracts.md)
- [Unsigned blockchain operation preparation](docs/development/blockchain-operation-preparation.md)
- [Artwork registration preparation](docs/development/artwork-registration-api.md)
- [Artwork verification preparation](docs/development/artwork-verification-api.md)
- [Condition attestation preparation](docs/development/condition-attestation-api.md)
- [Custody and manual fulfillment API](docs/development/custody-operations-api.md)
- [Artwork mint preparation](docs/development/artwork-minting-api.md)
- [Metadata commitment preparation](docs/development/metadata-revisions-api.md)
- [API environment and public configuration](docs/development/api-configuration.md)
- [API errors and logging](docs/development/api-errors-logging.md)
- [API health and shutdown](docs/development/api-health.md)
- [REST validation, CORS and limits](docs/development/api-rest.md)
- [Signed wallet authentication](docs/development/wallet-authentication.md)
- [Administrative authorization](docs/development/api-authorization.md)
- [Artist creation and manual verification](docs/development/artist-management-api.md)
- [Public artist profiles](docs/development/public-artists-api.md)
- [Artwork draft creation](docs/development/artwork-drafts-api.md)
- [Artwork draft editing](docs/development/artwork-draft-editing-api.md)
- [Public artwork discovery](docs/development/artwork-discovery-api.md)
- [Public artwork details](docs/development/artwork-details-api.md)
- [Local content-addressed storage](docs/development/local-storage.md)
- [Canonical document preparation](docs/development/document-preparation.md)
- [Shared TypeScript package](docs/development/shared-package.md)
- [Database package boundary](docs/development/database-package.md)
- [Artist profiles and database constraints](docs/development/artist-profiles.md)
- [Artwork identities and ID allocation](docs/development/artwork-identities.md)
- [Artwork media and materials](docs/development/artwork-media-materials.md)
- [Preserved artwork attestations](docs/development/artwork-attestations.md)
- [Manual custody and private fulfillment](docs/development/custody-fulfillment.md)
- [Wallet challenge and session persistence](docs/development/wallet-sessions.md)
- [Pending blockchain operations and receipts](docs/development/blockchain-operations.md)
- [Blockchain events and query projections](docs/development/blockchain-read-models.md)
- [Fictional database fixtures and phase checks](docs/development/database-fixtures.md)
- [Local PostgreSQL service](docs/development/local-services.md)
- [Foundation CI](docs/development/ci.md)
- [Solana package boundary](docs/development/solana-package.md)
- [Anchor program workspace](docs/development/anchor-workspace.md)
- [Local program testing](docs/development/program-testing.md)
- [Complete local Registry lifecycle](docs/development/registry-lifecycle.md)
- [Registry platform bootstrap](docs/development/registry-bootstrap.md)
- [Registry artwork identities](docs/development/registry-artwork.md)
- [Registry artwork authentication](docs/development/registry-verification.md)
- [Registry metadata commitments](docs/development/registry-metadata.md)
- [Registry condition attestations](docs/development/registry-condition.md)
- [Registry physical custody attestations](docs/development/registry-custody.md)
- [Registry Core asset minting](docs/development/registry-mint.md)
- [Generated Solana program clients](docs/development/program-clients.md)
- [Registry registration transactions](docs/development/registration-transactions.md)
- [Verifier transaction preparation](docs/development/attestation-transactions.md)
- [Artwork lifecycle transaction preparation](docs/development/lifecycle-transactions.md)

## Repository policy

Public history contains source code, tests with synthetic fixtures, manifests,
lockfiles, migrations, generated clients and IDLs, safe environment examples, and
project documentation. It excludes credentials, signing keys, real environment
files, private evidence, fulfillment details, local data, uploads, build output,
agent configuration, working notes, and source design files.

No license has been granted for this repository at this stage.
