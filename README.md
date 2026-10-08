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
package, an Anchor Registry, a Marketplace listing and atomic test-token settlement program, and a local
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
listings and sale distributions. Finalized Registry/Core/Marketplace polling and decoding now
provide validated activity pages; an explicit bounded worker atomically persists
events, ownership and replay-safe checkpoints. Paginated backfill, bounded RPC
retries, persisted gaps, network binding and Core ownership diagnostics support
recovery without replacing event-derived ownership with account snapshots.
Fictional draft fixtures and fresh-database constraint tests complete the database
foundation.
The API now validates server settings before listening and provides an explicit
public configuration allowlist, fixed domain error responses, server-generated
request IDs, structured logs that omit private request data, separate liveness and
database readiness endpoints, bounded HTTP/database shutdown, shared REST contracts,
restricted CORS, request-size limits, pagination validation, and signed wallet
challenges with replay-protected bearer sessions, server-configured admin/verifier
guards, finalized Registry authority checks, and authorized artist creation and
manual profile verification, public verified-artist queries with safe field projections,
and admin artwork draft creation, editing and protected paginated listing with retry-safe permanent IDs,
protected attribution, optimistic concurrency checks, a structured admin editor with atomic material persistence, and public artwork discovery
with category filtering and a publication gate, plus public artwork details with
finalized attestation summaries and explicit indexed ownership/freshness. A local
storage provider validates content-addressed bytes with separate public/private
namespaces. Authorized document preparation now preserves canonical public metadata
and private condition bytes. Administrators can upload bounded media, order it, and
explicitly approve public copies while keeping condition evidence private. Internal
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
intent per artwork and cluster. The metadata revision screen compares approved documents, appends public story changes, and connects explicit atomic Registry/Core updates. The protected minting screen now connects explicit wallet
approval, finalized binding reconciliation and separately confirmed publication after
matching indexed verification, inspection, metadata and ownership. Metadata commitment preparation now supports
initial, pre-mint and atomic post-mint Registry/Core revisions from immutable stored
documents. Receipt reconciliation now verifies signed preparations and exact finalized
transactions, retaining unresolved attempts without creating domain history.
Authenticated purchase quotes now read finalized listings, display exact test-token distributions, and bind unsigned purchase preparation to the buyer and reviewed terms. Listing, cancellation and purchase receipts verify exact signed preparations; marketplace sale indexing remains separate work.
Public provenance now exposes ordered finalized Registry/Core claims and condition
history with immutable attribution, validated bindings, two-stream gaps/lag and
persisted ownership-check freshness. Private report content remains excluded. The web scaffold now uses an editorial
design foundation with warm ivory, charcoal, the approved Katha emblem and reusable
visual tokens. A responsive public header, visible navigation, keyboard skip link
and project footer now form the application shell. A read-only public API client
validates shared schemas and provides safe route loading, error and not-found
states. The permanent-ID artwork page now presents public photography, artist
attribution and cultural documentation, with separate recorded verification,
condition-inspection and physical custody summaries. The public catalogue supports
category browsing, and artist profiles preserve attribution independently of
collectors. The homepage introduces the cultural purpose, Mandala, Paubha and
Thangka, with up to three published works from the catalogue and explicit
empty/unavailable states. A reproducible Chromium suite now checks public
navigation, keyboard focus, responsive wrapping, automated accessibility and
recovery from unavailable data. Authorized NFC administration now assigns unique
public tag references, preserves their permanent artwork binding and supports
terminal retirement. Public NFC resolution now redirects active tags to permanent
artwork pages, hides unpublished bindings and rejects retired tags; physical tag
writing and local/LAN setup are documented, with tested resolution stability through
synthetic title and owner changes, retirement and replacement. The artwork page now explains physical identity, guides
comparison with its documented features and inspections, and states that basic NFC
can be cloned and does not independently prove authenticity.
The header now connects Wallet Standard Solana wallets, displays authorized public
accounts and handles account changes and disconnection. Connection does not sign in
or approve transactions. A separate sign-in signs a validated nonce challenge and
keeps the API session in memory; sign-out and account changes clear it. The wallet
panel displays the configured Localnet/Devnet test environment. A shared transaction
review boundary now validates and simulates prepared Registry messages, requests
explicit wallet approval, records signed attempts and reconciles finalized outcomes
with separate indexing feedback; the protected administration page now supports artist creation, saved-profile review and explicit manual artist verification. Artwork drafts, media management and the registration workflow are connected, with exact document review, simulation, explicit wallet approval and protected receipt/indexing feedback. Artwork authenticity now connects manual inspection and authorship approval to verifier-authorized preparation, wallet signing and finalized receipt/indexing feedback. Condition inspection now connects private evidence upload and immutable report preparation to explicit verifier signing, current owner/custody scope checks and report-specific finalized receipt/indexing feedback. Custody administration now connects finalized physical state and private fulfillment requests to explicit manual status confirmation, authority-bound custody signing and separate receipt/indexing feedback. Marketplace transaction builders now prepare owner-bound listings, seller cancellation,
permissionless expiry recovery and buyer-bound purchases through generated clients.
Listing and purchase preparation APIs are available; collector marketplace screens remain planned.

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
- [Artwork registration administration](docs/development/artwork-registration-web.md)
- [Artwork verification preparation](docs/development/artwork-verification-api.md)
- [Artwork authenticity administration](docs/development/artwork-verification-web.md)
- [Condition attestation preparation](docs/development/condition-attestation-api.md)
- [Custody and manual fulfillment API](docs/development/custody-operations-api.md)
- [Artwork mint preparation](docs/development/artwork-minting-api.md)
- [Metadata commitment preparation](docs/development/metadata-revisions-api.md)
- [Finalized operation receipts](docs/development/operation-receipts-api.md)
- [Finalized Registry/Core/Marketplace activity ingestion](docs/development/chain-activity-ingestion.md)
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
- [Web design system](docs/development/design-system.md)
- [Public application shell](docs/development/application-shell.md)
- [Public web API client](docs/development/public-api-client.md)
- [Public artist profile pages](docs/development/artist-profiles-web.md)
- [Cultural homepage and featured artworks](docs/development/homepage.md)
- [Public browsing and accessibility checks](docs/development/public-browsing-tests.md)
- [Wallet Standard connection](docs/development/wallet-connection.md)
- [Wallet sign-in and session handling](docs/development/wallet-sign-in-web.md)
- [Wallet transaction lifecycle](docs/development/transaction-lifecycle-web.md)
- [Artist onboarding administration](docs/development/artist-onboarding-web.md)
- [Artwork draft administration](docs/development/artwork-draft-list-web.md)
- [Structured artwork documentation editor](docs/development/artwork-draft-editor-web.md)
- [Condition inspection administration](docs/development/condition-inspection-web.md)
- [Custody and fulfillment administration](docs/development/custody-administration-web.md)
- [Minting and public publication](docs/development/minting-administration-web.md)
- [Metadata revision review and submission](docs/development/metadata-administration-web.md)
- [Authorized artwork onboarding integration](docs/development/admin-lifecycle-tests.md)
- [Artwork media administration](docs/development/artwork-media-administration.md)
- [NFC tag administration](docs/development/nfc-administration.md)
- [NFC writing and local/LAN demonstration](docs/development/nfc-tag-writing.md)
- [Artwork exploration and category filtering](docs/development/artwork-exploration.md)
- [Canonical artwork page, provenance and metadata integrity](docs/development/artwork-page.md)
- [Public provenance and condition timelines](docs/development/artwork-provenance-api.md)
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
- [Local marketplace settlement fixtures](docs/development/marketplace-fixtures.md)
- [Authorized Marketplace configuration](docs/development/marketplace-configuration.md)
- [Listing records and sale eligibility](docs/development/marketplace-eligibility.md)
- [Fixed-price listing creation and Core locking](docs/development/marketplace-listings.md)
- [Listing cancellation and expiry recovery](docs/development/marketplace-cancellation.md)
- [Checked primary and secondary sale distributions](docs/development/marketplace-distributions.md)
- [Atomic test-token purchases and Core transfer](docs/development/marketplace-purchase.md)
- [Marketplace transaction preparation](docs/development/marketplace-transactions.md)
- [Complete local primary sale](docs/development/marketplace-primary-sale.md)
- [Inspected resale in both custody situations](docs/development/marketplace-resale.md)
- [Devnet payment provider](docs/development/devnet-payment-provider.md)
- [Artwork listing API](docs/development/artwork-listings-api.md)
- [Buyer purchase quotes and preparation](docs/development/artwork-purchases-api.md)
- [Authenticated collector account and holdings](docs/development/collector-api.md)
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

Finalized Marketplace settlements now preserve primary/secondary sale amounts,
fees and immutable listing cycles across resale and indexer replay. Core transfer
evidence remains the single public ownership timeline entry for each purchase;
physical custody stays separate. See the [indexer guide](docs/development/chain-activity-ingestion.md).

Authenticated account and collection APIs now expose published indexed holdings,
Core reconciliation status, and separate finalized physical custody. Collector
pages remain subsequent frontend work. See the [collector API guide](docs/development/collector-api.md).
