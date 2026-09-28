# Katha Devnet MVP specification

Status: planned and under implementation.

The [architecture overview](../architecture/overview.md) and
[artwork lifecycle](../architecture/artwork-lifecycle.md) define system boundaries
and the independent state transitions that implement these requirements.

This document defines the behavior and acceptance criteria for Katha's first
complete Devnet release. It is a product specification, not a statement that every
described feature has shipped.

## 1. Product purpose

Katha documents culturally significant handmade art from Nepal and connects each
verified physical work to a durable digital identity. The first release focuses on:

- Mandala art;
- Paubha;
- Thangka.

The physical artwork is the primary asset. The digital record supports attribution,
verification commitments, ownership, provenance, settlement, and transfer history.
The product must remain useful to people who do not understand Solana.

The MVP succeeds when one real test artwork completes this lifecycle on Devnet:

1. Katha records the artist and the physical artwork.
2. The artwork receives an immutable Katha ID.
3. Katha authenticates and inspects the artwork.
4. The exact metadata and condition documents are committed by hash.
5. One Metaplex Core asset is created and bound to the artwork.
6. An NFC tag resolves to the permanent public artwork page.
7. Wallet A purchases the artwork.
8. Ownership and provenance reflect Wallet A while authorship remains unchanged.
9. The artwork becomes eligible for resale under the applicable custody rules.
10. Wallet B purchases the approved resale.
11. Core ownership, sale history, custody, condition history, and provenance reflect
    the completed lifecycle without losing earlier records.

## 2. Core concepts and invariants

### 2.1 One physical work, one durable identity

Every registered artwork has a permanent, category-based identifier such as
`KATHA-PAUBHA-000001`. That identifier never changes and ties together the physical
work, public URL, NFC tag, database records, verification history, media, Registry
record, and Core asset.

The canonical public artwork URL uses the permanent identifier under the owned
Katha domain, for example `https://katha.fun/art/KATHA-PAUBHA-000001`.

An artwork identity exists before minting. A verified artwork can be bound to
exactly one deterministically derived Core asset. Asset creation and registry
binding must succeed atomically so neither side can exist as a successful partial
operation.

Fractional, fungible, or synthetic representations are outside the MVP.

### 2.2 Authorship, ownership, and custody are separate

- **Authorship** identifies the artist and never changes through a sale. An artist
  profile may exist without a creator wallet.
- **Digital ownership** is the current owner of the Metaplex Core asset and changes
  when a valid purchase transfers it.
- **Physical custody** identifies who possesses or safeguards the physical work and
  can change independently from digital ownership.

Buying the artwork does not automatically transfer copyright or reproduction
rights. Listing an artwork does not change its physical custody.

### 2.3 Verification is a recorded claim

Katha manually verifies artists, artwork authenticity, and condition in the MVP.
The chain proves that an authorized verifier recorded a commitment at a particular
time. It does not independently inspect physical reality.

Verification status, physical custody, marketplace listing status, and resale
inspection approval must remain separate states. A valid transition in one state
must not silently alter another.

### 2.4 NFC is a discovery bridge

An assigned NFC tag resolves to the artwork's permanent Katha URL. A basic tag can
be copied, so its presence is not independent authenticity proof. Retiring or
replacing a tag must not change the artwork identity or canonical artwork URL.

Cryptographic NFC and tamper-evident hardware are future enhancements.

## 3. People and roles

### Artist

An artist profile contains public attribution information, biography, region,
traditions, verification status, approved media, and optional public links. Katha
may onboard artists manually. Artist self-service onboarding is not required.

Creator identity and payout authority are separate. An artist needs a configured
payout wallet before an artwork can be offered for sale, even when the profile has
no creator wallet.

### Collector

A collector connects a compatible Solana Wallet Standard wallet, authenticates by
signing a replay-protected challenge, views owned works, purchases eligible
listings, requests physical delivery, and lists owned works when resale conditions
are satisfied.

### Katha administrator and verifier

Authorized roles create artist profiles and artwork drafts, register artworks,
verify authenticity, record inspections, coordinate custody and fulfillment,
mint verified assets, publish metadata revisions, and approve eligible resales.
Every protected action must verify the connected signer and current role.

### Public visitor

A visitor can browse verified artworks and artists, resolve an NFC tag, read the
artwork story, see current public state, and inspect verifiable provenance without
connecting a wallet.

## 4. Artwork documentation

The structured artwork record includes:

- permanent Katha ID, title, and category;
- immutable artist attribution and authorship evidence commitment;
- creation year and origin;
- dimensions, materials, and technique;
- story, meaning, cultural context, and creation process;
- ordered public media with roles such as hero, front, back, detail, artist with
  artwork, creation process, condition, certificate, and video;
- verification, custody, and current condition summaries;
- Core asset and Registry addresses after minting;
- current listing and public ownership information;
- metadata integrity and indexing status.

Draft content can be edited before publication while permanent identity and
immutable attribution fields remain protected. Public discovery returns only
content approved for publication. Private evidence, contact details, shipping
addresses, and internal inspection material must never appear in public responses.

## 5. Canonical documents and integrity

Katha produces versioned canonical metadata and condition documents. Their exact
bytes are hashed with SHA-256 and the commitments are anchored in the Registry.
Each new version preserves the previous version, author, timestamp, content hash,
and related transaction.

Rich media and documents live outside Solana behind a `StorageProvider` boundary.
Development may use validated content-addressed local storage. Public documents
contain no private fulfillment or personal information.

Before minting, metadata versions can update the Registry commitment. After
minting, a metadata revision must update the Core URI and Registry commitment in
one atomic transaction. A mismatched document or silent content change must be
visible as an integrity failure.

## 6. Authentication and condition

### Artwork authentication

The manual workflow records the artist, physical inspection, dimensions, materials,
photographs, authorship confirmation, verifier, timestamp, and canonical evidence
commitment. Only an authorized verifier can authenticate a registered artwork.

Verification must reject duplicate registration, wrong authorities, forged account
relationships, invalid states, wrong collections, and mismatched artwork identity.

### Condition history

Condition is a sequence of attestations rather than a permanent field. A report has:

- artwork and report identities;
- grade and reason;
- verifier and timestamp;
- notes and media commitments;
- exact canonical report hash;
- related chain transaction.

Supported reasons include initial verification, pre-sale, post-delivery,
pre-resale, return to custody, and insurance inspection. Detailed reports and
private photographs remain off-chain; trust-critical hashes and verifier identity
are anchored on-chain.

## 7. Physical custody and fulfillment

Custody transitions are explicit, authorized, and historically preserved. They
record Katha custody, the actual owner/custodian holding the work, or transit.
Registration and verification remain separate from custody; pending inspection
and resale approval belong to the inspection workflow. A sale changes digital
ownership without asserting physical movement or replacing the recorded custodian.

Physical inspection, tag writing, packaging, shipping, receipt confirmation, and
delivery coordination remain manual. A successful chain transfer never claims that
the physical artwork moved. Private fulfillment requests are accessible only to
authorized users and must not enter public provenance payloads.

The system supports both resale situations:

1. **Katha-held work:** the physical artwork remains in Katha custody while digital
   ownership changes, so another physical inspection may not be necessary.
2. **Collector-held work:** the current owner requests resale, Katha manually
   inspects the work, and an approval is issued for that owner and custody state.

Collector-held resale approval uses a configurable 30-day validity default. Listing
and purchase both recheck the current Core owner, custody, approval owner, inspection
age, and artwork condition. Expired or stale approvals cannot be used.

## 8. Solana records

Katha uses two Anchor programs and Metaplex Core:

- the **Registry** owns platform configuration, permanent artwork records,
  attribution, verification, metadata commitments, condition attestations, custody
  transitions, Core binding, and structured events;
- the **Marketplace** owns configuration, fixed-price listing records, sale
  eligibility, settlement, and marketplace events;
- **Metaplex Core** is authoritative for current digital ownership of the unique
  artwork asset.

Trust-critical records contain bounded values and hashes rather than long text or
media. Sensitive instructions validate signers, account owners, PDA seeds, program
IDs, Core collection and asset relationships, lifecycle states, payment mint,
recipients, and checked arithmetic.

The API prepares unsigned transactions. The connected, authorized wallet reviews
and signs them. Development authority operations may use dedicated Devnet roles;
no private key or seed phrase belongs in the repository, browser bundle, API
responses, or logs.

## 9. Marketplace behavior

The MVP supports fixed-price primary and secondary sales using a clearly labeled
six-decimal Devnet test token. JSON payment amounts are integer decimal strings.
Development defaults are:

- platform commission: 250 basis points;
- secondary artist royalty: 500 basis points.

These values simulate the lifecycle and are not production economic commitments.
Primary proceeds go to the artist after commission. Secondary proceeds are split
among seller, artist, and treasury using checked integer arithmetic.

A seller must own the Core asset and the artwork must be verified and sale-eligible.
Creating a listing installs temporary Core Freeze Delegate and Transfer Delegate
authorities and locks the asset while the seller retains ownership. Cancellation
or valid expiry recovery removes those temporary authorities and unlocks the asset.

Purchase must atomically:

1. revalidate the active, unexpired listing and current artwork eligibility;
2. validate buyer, seller, recipients, payment mint, amount, and balances;
3. distribute the exact checked payment amounts;
4. transfer Core ownership to the buyer;
5. close or mark the listing purchased and emit the settlement event.

Wrong mints, stale listings, expired inspections, insufficient funds, recipient
mismatches, repeated purchases, races, or arithmetic errors must fail without a
partial payment or ownership transfer.

## 10. Application behavior

### Public experience

The English-language public application presents the cultural object before its
technical details. It includes:

- a cultural introduction and featured-artwork home page;
- artwork exploration with category filtering;
- artist profile pages;
- a canonical artwork page keyed by permanent Katha ID;
- artwork photography, story, meaning, materials, dimensions, origin, technique,
  and creation process;
- authentication, condition, physical custody, listing, and ownership summaries;
- complete provenance and condition timelines;
- metadata integrity and Solana verification details;
- accurate NFC and physical-identity explanations.

The visual direction uses the approved Katha profile logo, warm ivory, charcoal,
muted red, editorial typography, strong photography, and generous whitespace.
The selected X banner is for the official `@kathadotfun` X profile. Reviewed
application copies of brand assets may be published when the design system is
implemented.

### Administration

Protected administration supports artist onboarding, artwork drafts, structured
documentation, ordered media, registration, authentication, inspection, custody,
minting, publication, and metadata revision. Every transaction flow shows
simulation, wallet approval, submission, final confirmation, and actionable errors.

### Collector experience

Authenticated collectors can see their wallet and cluster, current holdings,
ownership and custody state, listing eligibility, exact purchase quotes, fee and
royalty distributions, active listings, cancellation or expiry recovery, delivery
requests, and collector-held inspection/resale status.

## 11. API and data requirements

Request and response contracts are shared as Zod schemas. External inputs,
environment variables, canonical documents, transaction parameters, and admin
forms are validated. Public and private response shapes are separate.

PostgreSQL preserves relational data for artists, artworks, ordered media and
materials, versioned metadata, verifications, condition reports, custody history,
private fulfillment, wallet challenges and sessions, pending chain operations,
receipts, listings, sales, ownership, indexed events, and checkpoints.

Permanent Katha ID allocation must be safe under concurrent requests. Database
constraints enforce relational invariants, but indexed ownership and provenance
remain read models derived from successful finalized chain activity.

Wallet sessions use a nonce-based signed challenge with domain, wallet, cluster,
issued time, expiry, and one-time use. Challenges resist replay. Administrative
routes enforce configured admin and verifier authorization after authentication.

The API exposes readiness, bounded pagination, consistent domain errors, request
IDs, redacted structured logs, and graceful shutdown. It applies explicit CORS and
request-size limits. Raw internal errors, credentials, private evidence, and
fulfillment information are never returned publicly.

## 12. Indexing and provenance

A polling worker runs alongside the API codebase and consumes finalized Registry,
Marketplace, and Core activity. It writes decoded events, derived read models, and
the corresponding checkpoint in one database transaction.

The indexer must:

- restart and replay without duplicates;
- backfill a configured slot range;
- retry transient failures without skipping activity;
- expose detected gaps and last finalized checkpoint;
- reconcile indexed ownership against Core;
- avoid creating provenance from failed transactions;
- avoid duplicating one sale across Marketplace and Core observations.

The public provenance timeline distinguishes authorship, Katha verification,
condition, custody, primary sale, secondary sale, and current ownership. It shows
indexing freshness or gaps rather than presenting stale derived data as complete.

## 13. Development and demonstration boundaries

The supported demonstration runs against local or LAN-hosted application services
and Solana Devnet. Katha owns `katha.fun`, which is the canonical public domain;
hosted application deployment remains outside this MVP sequence. Automated tests
use synthetic artworks and temporary test identities. The final manual demonstration
uses an artwork, approved media, two wallets, and an NFC tag supplied outside Git.

The software provides `StorageProvider`, `WalletSession`, and Devnet
`PaymentProvider` boundaries so development implementations can later be replaced
without rewriting domain rules.

The following remain outside this MVP:

- mainnet and hosted production operations;
- production economics, legal settlement, NPR conversion, and automatic off-ramp;
- auctions, offers, fractional ownership, fungible tokens, staking, or governance;
- embedded wallets, mobile apps, social feeds, subscriptions, and recommendations;
- automatic international customs, insurance, and physical delivery;
- AI valuation or authenticity claims;
- cryptographic NFC, advanced material analysis, and institutional integrations;
- multi-chain or cross-chain behavior.

## 14. Acceptance criteria

The MVP is complete only when automated and manual checks demonstrate all of the
following:

- duplicate artwork registration, wrong authorities, forged accounts, wrong Core
  collections, and invalid custody transitions fail;
- artist attribution and permanent Katha ID remain unchanged through both sales;
- one verified artwork binds to exactly one Core asset;
- metadata tampering is visible and revisions preserve earlier commitments;
- failed transactions never create verification, ownership, or sale history;
- wrong payment mints, stale listings, expired inspections, insufficient funds,
  duplicate purchases, and settlement races fail without partial effects;
- indexer restart, replay, and backfill produce no duplicates and surface gaps;
- Wallet A owns the Core asset after the primary purchase;
- Wallet B owns it after the approved resale;
- both Katha-held and collector-held custody/resale paths work;
- NFC still resolves to the same permanent artwork identity after every transfer;
- public API responses, logs, test artifacts, and Git history contain no credentials,
  private evidence, fulfillment details, personal data, or signing material;
- a fresh checkout can reproduce the documented local setup and Devnet demo.

Physical inspection, NFC writing, wallet approvals, Devnet deployment, and delivery
coordination are manual acceptance activities performed by the operator.
