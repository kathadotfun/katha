# Artwork purchase and inspection history

The permanent `/art/{kathaId}` page preserves original artist attribution and an
ordered, paginated public history. Digital ownership, physical custody and manual
inspection remain distinct. History freshness, missing activity and Core owner
reconciliation remain visible; a page is not a live chain check.

## Purchases appear once

A Core transfer receives a primary or secondary purchase label only when an indexed
Marketplace settlement matches the same finalized signature, transaction position,
outer instruction, asset, buyer and listing authority. The listing PDA, cycle,
payment mint, exact price and distribution are validated. Recipient overlap retains
separate proceeds, royalty and platform roles. Amounts are integer base units of the
configured test token, not NPR or production economics.

The settlement is attached to the transfer rather than inserted as another public
ownership event. Transfers without matching settlement remain transfers; missing
settlement evidence does not prove that no purchase happened. Cancelled listings,
failed transactions and private requests never appear as successful purchases.
Indexing gaps and replay recovery are documented in the indexer guide.

## Historical inspections and custody

Each condition entry retains its chain version, grade, reason, verifier, inspection
time, report address and document SHA-256. Locally finalized report bytes are checked
against the exact event commitment, canonical format, artwork/report identities and
receipt. A photograph appears only if its hash belongs to that report and its current
artwork-media visibility is PUBLIC. Only approved image hashes, MIME types and alt
text enter the response; media URLs are constructed from the configured public
storage service. Withdrawing visibility removes the photograph from future reads.
Absent documents or approved media leave the report commitment visible.

Private report bytes, notes, inspector IDs, private media hashes, fulfillment,
shipping information and resale requests are excluded. Public image hashes identify
bytes; the page does not download and hash every displayed photograph. The public
history does not authenticate physical reality or imply inspection approval is still
valid. Listing and purchase eligibility use the separate finalized approval checks.

Custody entries display their revision, before/after state and attesting authority.
A digital purchase never asserts physical movement. Earlier condition commitments
remain visible after later inspections and sales. The original artist remains linked
through every owner change.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm db:test
pnpm build
pnpm --filter @katha/web test:public-journeys
```

Synthetic fixtures cover two purchases, two condition versions, collector custody,
approved photography, private evidence exclusion, wrong settlement accounts/amounts,
wrong report commitments/receipts and photo withdrawal. No real wallet approval,
physical inspection or Devnet deployment is performed by these view tests.
