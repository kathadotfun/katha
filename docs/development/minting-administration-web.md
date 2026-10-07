# Minting and public publication

Visit `/admin/artworks/<Katha ID>/minting` from custody administration. Connect
and sign in through the header on the configured localnet or Devnet cluster.
The page requires a current administrator session. Minting additionally requires
the Registry registration authority; a different administrator may publish an
already finalized eligible artwork.

## Review and mint

Reload saved state to read protected metadata and finalized Registry/Core accounts.
Review the exact canonical public metadata, its SHA-256 commitment, initial report
ID/hash, deterministic Core asset, configured collection, initial digital owner,
and held physical custody. Private inspection notes and evidence bytes are omitted.
Artist approval, immutable attribution, successful verification, initial inspection,
metadata commitments and held custody must match. An occupied asset or existing
binding prevents another mint. Authorship and physical custody remain independent
of digital ownership.

Confirm the review and choose **Prepare Core mint**. Preparation reuses an existing
reservation for its original wallet; it never replaces an UNKNOWN signed attempt.
The browser verifies the generated instruction, all fourteen accounts and their
roles, permanent identity, collection, report and metadata revision before simulation.
The existing transaction panel shows fees and requires a separate wallet approval.
Cancelling that panel does not mint or publish. No API service holds signing keys.

After signing, the retained signature is reconciled against the exact finalized
transaction. The protected mint status must report that same signature as indexed;
the finalized Registry binding and Core account must agree. Reload saved state after
indexing completes. RPC errors and indexing delays never authorize publication.

The mint instruction encodes account relationships rather than condition/custody
compare-and-swap arguments. The program rechecks live prerequisites at execution;
newer valid condition or held custody state may be observed. Review again when the
state may have changed. This screen does not create a listing or authorize a sale.

## Publish

Publication is a separate action. Review the finalized asset and approved public
metadata, confirm publication, then choose **Publish artwork**. The API checks the
live finalized Core owner, URI/name, Registry binding, verification/inspection and
metadata commitments against local indexed records. A database transaction locks
the artwork and rechecks artist approval, current documents, matching finalized
mint receipt/event, ownership and the optimistic `updatedAt` timestamp before
setting `publishedAt`. Competing requests cannot publish from the same stale review.
An unresolved signature, different owner/asset, stale metadata or missing indexing
returns a conflict. Reload saved state before retrying an uncertain write.

Publication makes the artwork eligible for existing public discovery/detail routes
at `/art/<Katha ID>`; it does not expose private evidence or fulfillment data. The
public gate continues requiring verified artist and finalized records. Chain reads
and database writes are separate systems: a later chain change is indexed through
the existing worker, and future transaction operations must recheck live state.

## Protected contracts

- `GET /admin/artworks/:kathaId/minting`: shared `ArtworkMintReview`, no-store.
- `POST /admin/artworks/:kathaId/operations/mint`: existing strict
  `ArtworkMintRequest`; returns the unsigned simulated operation.
- `POST /admin/artworks/:kathaId/publication`: strict
  `{ expectedUpdatedAt, publicationConfirmed: true }`; returns the refreshed review.

Sessions, roles and cluster are checked before private reads. Identity changes clear
the screen and abort pending work. Only public canonical metadata enters the review;
report IDs/hashes are commitments, not independent proof of physical authenticity.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm format:check`, `pnpm codegen:check` and
`pnpm --filter @katha/web test:public-journeys`.
Tests use synthetic artwork, accounts and temporary identities. They cover changed
mint accounts, authorization, stale reviews, UNKNOWN guards, indexing delays,
publication races and public visibility. Browser checks exercise simulation/cancel,
explicit publication, conflict/reload and revoked access at mobile and desktop
widths. Actual artwork inspection, wallet approval and Devnet deployment remain
manual operations.

Reference: [Solana finalized account reads](https://solana.com/docs/rpc/http/getmultipleaccounts)
and [Metaplex Core assets](https://www.metaplex.com/docs/smart-contracts/core).
