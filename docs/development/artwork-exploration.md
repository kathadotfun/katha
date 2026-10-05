# Artwork exploration

`/explore` reads the public artwork discovery API and links each work to its
permanent `/art/<Katha-ID>` page. Home and the primary navigation expose the
catalogue. The headline and supporting text place Nepali Mandala, Paubha and
Thangka traditions alongside Real World Assets. No fabricated works, stock images,
price estimates, sale eligibility or live authenticity guarantees are displayed.

## Filters and navigation

Category links select `MANDALA`, `PAUBHA`, `THANGKA` or all artworks. Each category
change resets the offset to zero. The selected link has both `aria-current="page"`
and a visible underline. Navigation works without JavaScript.

The route requests 12 works per page. Previous/next links preserve the category;
offsets must be canonical nonnegative multiples of 12 and at most 100,000.
For example, `/explore?category=PAUBHA&offset=12` displays page two. Unknown keys,
repeated parameters, invalid categories and unsupported offsets show a resettable
filter message without contacting the API; metadata marks these queries noindex.
Valid canonical metadata uses `https://katha.fun/explore` with the selected query.
There is no claimed total result count: the API exposes only the current page and
`hasMore`. Offset pagination is not a snapshot and may change with publication.
At the API's offset limit, additional history is not silently presented as complete.

The loader validates the shared response plus requested limit/offset/category and
unique permanent IDs. A malformed or mismatched response becomes an unavailable
catalogue, preserving valid filters for retry. HTTP failures are not empty results,
and upstream/internal messages never appear in the page. Empty first pages describe
unpublished/unavailable catalogue works; later empty pages offer a first-page link.
A route loading boundary announces loading with `role="status"`; failures use an
alert and retry link. No wallet connection is needed for these public reads.

## Photography and attribution

Cards show the approved HERO image, art form, recorded year, title, artist name and
permanent Katha ID. Artist names link to the corresponding public profile. Images use
the existing uncropped photograph component, escaped approved alt text and its
image-failure state. Grid columns adapt from one to two to three; long titles and
identifiers wrap. Artist attribution stays independent of ownership.

The discovery image projection now includes `mimeType` alongside `id`,
`contentHash` and `altText`. This is needed to select the storage filename extension;
it does not expose a provider path or arbitrary URL. JPEG, PNG, WebP and AVIF target
fixed `/storage/public/<hash>.<extension>` paths on `KATHA_PUBLIC_API_ORIGIN`.
Missing or unsupported photographs show a labelled placeholder, with no private
fallback. API, database and frontend contracts must be updated together for this
required field. Publication/privacy rules remain unchanged; no migration is needed.

## Verification

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

`db:test` owns disposable PostgreSQL and never modifies the development database.
The HTTP command starts temporary loopback services with synthetic responses and
checks exploration success, correct PNG delivery URL, filtering, page navigation,
empty/outage states, invalid/duplicate queries, canonical artwork links and Home
navigation. It also retains the existing artwork-detail/provenance checks. Native
render tests cover empty/missing-image/error states, escaped content and attribution.

For manual review, run the migrated API and web services as described in
[local setup](getting-started.md), then visit `/explore`. Draft seed records are not
published and should not be manually exposed to populate this page. Review at
narrow/wide widths, tab through category and paging links, block images and verify
the unavailable-photo state, and test category switching from a later page.
