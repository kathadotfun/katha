# Canonical artwork page

The public page lives at `/art/[kathaId]`, for example
`/art/KATHA-PAUBHA-000001`. Its canonical metadata points to the same permanent
identity under `https://katha.fun`. A changed title, artist display name or owner
never changes this address. Local/LAN services do not require domain deployment.

The page shows the recorded art form, title, artist, creation year, permanent ID,
public photography, origin, dimensions, materials, technique, story, meaning,
cultural context and creation process. Authorship is labelled independently of
ownership, and collecting does not automatically convey copyright. Artist names
are plain text until profile pages exist. Verification, the latest available
condition inspection and recorded physical custody are shown in separate sections.
Indexed provenance, recorded Core ownership and metadata integrity follow the story.

## Data and failure behavior

Server Components use the [public API client](public-api-client.md). The route
validates permanent IDs before making a request. An invalid ID or API `NOT_FOUND`
resolves through Next.js `notFound()`; malformed data, outages and timeouts remain
errors handled by the existing safe error boundary. The response identity must
match the requested ID, even when the response otherwise passes its shared schema.

A React request-scoped `cache` shares the validated read between metadata and page
rendering. This is not a persistent artwork cache. The route is dynamic, and the
client retains `no-store` reads. Builds do not need a live API or seed artwork.

Next.js may commit HTTP 200 headers before a streamed not-found/error result.
Missing artwork still renders the not-found boundary and `noindex`; an outage
must never be displayed as a missing or verified artwork. See the official
[not-found convention](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
and [metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata).

Missing documentation is labelled, rather than replaced by invented information.
Long text wraps, preserves paragraph breaks and renders as escaped React text.
Dimensions retain exact recorded millimetres with explicit height/width/depth order.
Origin preserves the recorded places; absent locality does not imply a particular
city. Nepal's cultural identity comes from the documented object and artist.

## Verification and physical care

`ArtworkCare` renders only the validated public verification, condition and custody
summaries. Missing/unverified verification or missing/invalid inspection data fails
the shared response boundary and reaches the safe page error state. Katha verification is described as a recorded manual inspection, never
as independent blockchain proof of the physical object's authenticity. Physical
inspection time and verification recording time are separately labelled. Verifier
wallets are public record identifiers and wrap fully; related transactions appear in the provenance details.

Condition shows the latest available report's grade, version, inspection purpose,
inspection time and inspector wallet. All five grades and six purposes use explicit
English labels. Dates use deterministic UTC formatting with full timestamps in
semantic `time` elements. A report describes an observation at its inspection time,
not a live assessment or permanent guarantee. Earlier reports remain historical;
a pre-resale inspection alone does not establish resale approval. Private notes,
inspection images, evidence and fulfillment details are never rendered.

The physical custody section labels dated manual observations as Katha-held,
collector-held or in transit. It does not infer the collector's identity from the
Core owner. Unknown state, missing observation time or unknown source is presented
as unknown custody. Transit does not confirm delivery or receipt. This is a public
presentation rule; it does not modify any stored state or lifecycle transition.

The detail API currently exposes `UNKNOWN` or `GAP_DETECTED` indexing freshness.
The section states that freshness is unconfirmed or some history is missing, so
later inspections/custody changes may not appear yet. It never marks the record as
complete or current. The provenance section independently exposes the fuller worker status.

## Photography

Only public API image entries using JPEG, PNG, WebP or AVIF are rendered. URLs
are constructed from the configured public API origin, validated content hash and
fixed extension under `/storage/public/`. No arbitrary media URL, storage path,
SVG, private namespace or metadata URI is used as an image source. The API remains
responsible for public approval and byte integrity.

The gallery sorts by recorded position, prefers a HERO image (then FRONT, then the
first supported image), and preserves the remaining order. Full-work photographs
are contained without cropping, filtering, overlays or recolouring. Detail images
have explicit view labels. Existing alt text is preserved; missing alt text gets
a title/view description. The first image loads eagerly; additional images are lazy.
A client-side image-load failure gives an unavailable message. Missing photography
shows an empty state without stock/generated artwork. Certificate and condition
media are excluded from this cultural photography gallery.

Native image elements deliver approved bytes directly without Next.js image
transformation or a server-side image proxy. The browser must reach the configured
API origin; for LAN use, set it to the API's reachable LAN address rather than a
loopback address. HTTPS pages require an HTTPS media service. Private source media,
real uploads and test/build output stay outside Git.

## Run and verify

Build the shared package and run the API with migrated PostgreSQL as described in
[local setup](getting-started.md). Select an already published artwork; fictional
database draft fixtures alone do not satisfy the public publication gate. Then:

```bash
pnpm --filter @katha/shared build
KATHA_PUBLIC_API_ORIGIN=http://localhost:3001 pnpm --filter @katha/web dev
```

Visit `/art/<permanent-Katha-ID>`. The homepage does not yet link to the catalogue;
artwork discovery is implemented later.

```bash
pnpm --filter @katha/web test
pnpm --filter @katha/web lint
pnpm lint:root
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web build
pnpm --filter @katha/web test:artwork-page
pnpm format:check
```

The route integration command requires an existing production build and permission
to listen on temporary loopback ports. It starts a synthetic API and a temporary
Next.js server, checks successful/sparse artwork, permanent canonical metadata,
a single API read, missing/invalid IDs, outages and response-identity mismatches,
then stops both servers. It neither reads the real database nor deploys to Devnet.
Unit tests also cover media selection/URLs, exact dimensions, escaped markup and
null documentation. Care tests cover all grades/purposes, distinct UTC timestamps,
known/unknown/inconsistent custody, missing history and private-field exclusion.
The production route check also verifies the care sections. They compile JSX in memory with the existing workspace
TypeScript compiler; no generated tests or runtime demo routes are published.

Review at narrow and wide browser sizes, with keyboard navigation and image loading
blocked. Check uncropped photographs, visible focus, readable long text and the
unavailable image state. HTTP/component tests do not replace visual browser review.

## Provenance, digital ownership and integrity

The artwork route separately loads `/artworks/:kathaId/provenance` with 20 events
per page. `?historyOffset=20#provenance` advances through the API's ordered history;
offsets must be nonnegative multiples of 20, bounded at 100,000. An invalid offset,
missing history, malformed response or identity/attribution/network/asset mismatch
shows unavailable history with a first-page retry. It never replaces the artwork's
story with invented events. Empty pages do not establish absence of earlier history.
A detail read remains shared between page content and canonical metadata.

Registration, verification, metadata revisions, inspections, custody, minting and
Core transfers have distinct labels. Inspection and chain recording times remain
separate. A transfer names its destination; its authority is not presented as the
previous owner, and a transfer alone is not called a sale or physical delivery.
Earlier commitments are shown in transaction disclosures. Marketplace sale and fee
presentation is added with marketplace indexing later.

Ownership is explicitly an indexed Core observation with its date. The history API's
reconciliation state exposes missing, invalid, stale or mismatched ownership;
matching means matched at the recorded check, not a live RPC result. Indexing shows
unknown, gaps, lag, stale observations or the last observed finalized head, plus
blocked network status, program checkpoints and exact decimal-string slots. No
slot is converted to a JavaScript number. No completeness or real-time claim is made.

Metadata checking reads only the exact `/storage/public/<committed-hash>.json`
URL on `KATHA_PUBLIC_API_ORIGIN`. Arbitrary metadata URIs are never server-proxied;
other providers are labelled unchecked. The request omits credentials, rejects
redirects, disables caching, has a ten-second header/body deadline and a 1 MiB
stream limit. It compares SHA-256 of exact bytes, validates the existing metadata
schema, canonical encoding and immutable Katha/artist/creator identity. Hash
mismatches, invalid documents, unsupported URLs and unavailable reads remain
visible. No document body or private fields are rendered. Matching means agreement
with the public API commitment; the page does not independently query the Registry.
The detail response reuses the document URI validator, allowing local/LAN HTTP(S)
URLs while rejecting credentials, fragments and non-HTTP schemes.

Fixed [Solana Explorer](https://explorer.solana.com/?cluster=devnet) address and
transaction links explicitly select Devnet. Localnet records have no public
explorer link. Links open with `noopener noreferrer` and an accessible new-tab
label. Technical details use native disclosure controls after the cultural story;
full addresses/hashes wrap rather than truncate identity.

Tests cover exact-byte matching and tampering, invalid/noncanonical/wrong-identity
documents, arbitrary URL rejection, body limits/timeouts, response bindings,
pagination, ownership mismatch, all indexing states, Localnet/Devnet links and
rendered integrity failures. The production route check uses only synthetic data,
serves matching canonical metadata and an indexed transfer, follows history paging,
and verifies that unavailable history leaves sparse artwork readable. Interactive
browser review is still required for disclosure controls, narrow layouts and focus.
