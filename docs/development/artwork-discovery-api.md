# Public artwork discovery

`GET /artworks` is anonymous and returns a bounded page of published artwork
summaries. [Artwork details](artwork-details-api.md) use the same publication
predicate at `GET /artworks/:kathaId`.

```http
GET /artworks?category=PAUBHA&limit=20&offset=0
```

The optional category is exactly `MANDALA`, `PAUBHA` or `THANGKA`. Limit defaults
to 20 and accepts 1–100; offset defaults to 0 and accepts 0–100000. Numbers must be
canonical decimal strings. Duplicate parameters, unknown keys and invalid values
return `400 INVALID_REQUEST`. Clients cannot select another cluster through query
parameters. Storage failures return the standard redacted 500 response.

Responses contain `items` and `pagination: { limit, offset, hasMore }`. Items have
`kathaId`, `category`, `title`, `creationYear`, `artist: { id, slug, displayName }`
and nullable `heroImage: { id, contentHash, mimeType, altText }`. The hash identifies approved
image bytes; it is not a URL. The MIME type identifies the filename extension for public delivery. Approved bytes are delivered through the
[public storage route](document-preparation.md#public-delivery). Only a public IMAGE/HERO relation is included; absent or private heroes
produce null. Captions, provider storage keys, evidence, inspection documents,
wallet addresses and fulfillment information are omitted through explicit database
and response projections.

## Publication predicate

Migration `0009_artwork_publication.sql` adds nullable `artworks.published_at`.
Existing records and new drafts remain unpublished by default. Non-null timestamps
must be finite and no earlier than creation. Draft creation/editing cannot set this
field, and published records cannot be edited through the draft store. The authorized
publication writer belongs to the later mint-and-publish administration workflow.
Do not manually publish records to bypass that workflow.

Discovery additionally requires all of the following:

- Publication time has arrived and authorship evidence is committed in the record.
- The artist profile is verified.
- Verification and metadata have FINALIZED receipts on the configured server cluster.
- An INITIAL_VERIFICATION condition report is FINALIZED on that same cluster.
- Indexed asset ownership exists on that cluster.

Results sort by permanent Katha ID ascending. Historical attestations use EXISTS
predicates so multiple metadata revisions do not duplicate cards. Fetching one extra
row determines `hasMore`. Offset pagination is not a snapshot across concurrent
publication changes. An empty page is valid, including before publication/indexing
workflows are implemented.

This is a read-model eligibility check, not a live RPC authenticity assertion,
indexer freshness guarantee, or marketplace sale approval. Receipt reconciliation,
indexing status and the publication writer arrive in their scheduled steps. Artist
detail responses still return an empty related-artwork array pending that integration.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format:check`
and `pnpm db:test`. The disposable PostgreSQL case applies all migrations and checks
category/offset pagination, history deduplication, unpublished/future records,
unverified artists, missing or prepared attestations, missing ownership, cluster
separation, private heroes, strict public projection and the published draft-edit
barrier. Finalized test rows follow PREPARED → FINALIZED transitions using synthetic
receipts; no blockchain transaction is submitted.

Shared contracts live in `@katha/shared`; the query lives in `@katha/db` and the API
boundary in `apps/api/src/artwork-discovery.ts`.
