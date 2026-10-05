# Public artist profile pages

`/artists/<slug>` presents a verified artist's approved public biography, region,
traditions, optional portrait and links. Artist names on artwork detail and
exploration pages lead here. The permanent profile canonical URL is
`https://katha.fun/artists/<slug>`; the main caption connects Nepali art with Real
World Assets. There is no artist directory or administration UI in this step.

## Identity and data boundaries

The server validates the slug before requesting `/artists/:slug` and checks that
the returned slug matches. Only the strict verified public artist contract is
accepted. Invalid slugs and missing/unverified artists use the not-found/noindex
boundary; malformed data and service failures use the safe existing error boundary.
Request-scoped React caching shares one profile read between metadata and content.
The dynamic route requires no live API during a production build. A loading boundary
announces the public profile read.

Artist approval is explicitly a manual profile verification, not proof of every
physical artwork. Biography and tradition text render as escaped text, preserving
line breaks. The portrait uses the existing uncropped image component with its
failure state; a missing portrait has no stock/generated substitute. Approved
portrait URLs load directly in the browser with no referrer, never through a server
image proxy. Public links show their destination hostname and open with
`noopener noreferrer` and an accessible new-tab label. The public API validates
HTTP(S) URLs and rejects credentials. No private evidence, payout/verifier wallet,
fulfillment data, or current collector identity is displayed.

## Published artworks by the artist

The profile's work section reads `/artworks?artistId=<immutable-artist-ID>&limit=12`.
Discovery now accepts this optional UUID filter, combines it with category/paging
and retains the existing configured-cluster publication predicate and explicit
public projection. UUID filtering does not publish drafts or reveal unverified
artists' works. No migration is required. The artist response's legacy `artworks`
placeholder remains empty; the frontend uses the bounded discovery response.

The page rejects another artist's ID/slug, duplicate work IDs and mismatched
pagination, even when a response otherwise satisfies its shared schema. Matching
is based on immutable artist attribution, never the indexed Core owner's wallet.
A collector change does not change which artist's profile lists the work.

`?offset=12#artist-works` advances by 12; canonical nonnegative offsets are bounded
at 100,000. Unknown/repeated parameters and unsupported offsets show a reset link
and noindex metadata without fetching artwork rows. Profile biography stays useful
if this separate read fails. The work section offers retry, empty-page messaging,
previous/next links and permanent artwork URLs. An empty first page means no works
are currently published in the catalogue, not that the artist has created none.
Offset pagination can shift as publication changes, and no total count is claimed.

## Checks and manual review

```bash
pnpm typecheck
pnpm lint
pnpm --filter @katha/web exec node --test --test-isolation=none tests/*.test.ts
pnpm --filter @katha/shared test
pnpm --filter @katha/api test
pnpm db:test
pnpm --filter @katha/web build
pnpm --filter @katha/web test:artwork-page
pnpm format:check
```

Tests use synthetic artists and works. PostgreSQL checks confirm artist scoping,
category intersection, hidden drafts, missing attestations, unverified artists,
cluster boundaries and omitted private images. Native model/render tests cover
slug matching, private/unverified response rejection, wrong-artist works, response
paging, safe biography/links, missing portraits and separate artwork failures.
Production HTTP tests verify profile metadata/content sharing, artist links,
paging, empty/unavailable works, missing/unverified profiles, invalid slugs,
outages and response-identity mismatches. Disposable services never modify the
development database or deploy to a network.

For browser review, run the migrated API and web services using the configured
public origin. Open a verified artist's profile via an artwork page or exploration
card. Inspect narrow/wide layouts, long biography and tradition text, portrait-load
failure, keyboard focus, public-link destinations, empty works and later-page
navigation. Draft-only seed data is not a published catalogue. Do not bypass the
publication workflow to populate the profile.
