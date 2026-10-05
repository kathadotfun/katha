# Canonical artwork page

The public page lives at `/art/[kathaId]`, for example
`/art/KATHA-PAUBHA-000001`. Its canonical metadata points to the same permanent
identity under `https://katha.fun`. A changed title, artist display name or owner
never changes this address. Local/LAN services do not require domain deployment.

The page shows the recorded art form, title, artist, creation year, permanent ID,
public photography, origin, dimensions, materials, technique, story, meaning,
cultural context and creation process. Authorship is labelled independently of
ownership, and collecting does not automatically convey copyright. Artist names
are plain text until profile pages exist. Authenticity, condition, custody and
provenance presentation are separate additions.

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
null documentation. They compile JSX in memory with the existing workspace
TypeScript compiler; no generated tests or runtime demo routes are published.

Review at narrow and wide browser sizes, with keyboard navigation and image loading
blocked. Check uncropped photographs, visible focus, readable long text and the
unavailable image state. HTTP/component tests do not replace visual browser review.
