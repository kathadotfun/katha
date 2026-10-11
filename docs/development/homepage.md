# Cultural homepage and featured artworks

The `/` route introduces Katha with **Nepal's cultural art. RWAs on Solana.**
It connects visitors to the public catalogue, artist profiles and permanent artwork
records, with cultural background and an explanation of authorship, manual
verification, digital ownership and separate physical custody. The canonical URL
is `https://katha.fun/`; the English title and description identify the Devnet scope.
This route does not announce a hosted launch or offer a purchase workflow.

## Published content

The dynamic server page requests `/artworks?limit=3&offset=0` through the existing
anonymous, no-cookie, no-cache public API boundary. The API retains its configured
cluster publication gate: verified artist, published artwork, finalized attestations
and indexed Core ownership. No new eligibility rule or backend field is introduced.
The homepage validates the strict shared response, exact pagination, unique IDs
and ascending Katha ID order. Drafts, private fields, duplicate IDs and malformed
responses never render as featured works.

“Featured artworks” means the first available three published records in permanent
ID order, stated next to the section heading. It is not a curated ranking, a recent
publication feed or proof of current sale availability. New publication can change
this subset. The page makes no catalogue size, popularity or price claim.

Each work shows category, creation year, artist attribution and permanent ID, with
links to `/art/<kathaId>` and `/artists/<slug>`. Public text is escaped. Approved
photographs use the existing content-addressed public storage URL builder and
uncropped image component; missing, unsupported and failed images are explicit.
No generated/stock works or local helper assets fill an empty catalogue.

An empty catalogue and an unavailable catalogue have distinct messages. API
failures never reveal upstream details; the cultural introduction and exploration
links remain available. Existing root loading and safe error boundaries apply.
The page needs no running API during a production build. At runtime the validated
`KATHA_PUBLIC_API_ORIGIN` must be configured as described in the public API docs.

## Cultural context

Short introductions recognize the Newar Paubha and Tibetan Thangka traditions
rather than treating them as interchangeable or exclusively Nepali in origin.
The Mandala introduction describes its Buddhist sacred-space composition.
Background links sit alongside each introduction, using the Rubin Museum of
Himalayan Art's [Art Making](https://rubinmuseum.org/projecthimalayanart/themes/art-making/)
and [Art of Mandala](https://rubinmuseum.org/highlights/mandala/) references.
The artist's own documented meaning and cultural context remain the source for
an individual work. Museum imagery is not copied or embedded.

The page follows the [design system](design-system.md): madder red hero with the
stepped Dhaka mark, paper sections, Eczar headings and a Devanagari कथा closing
band. The hero drawing is decorative and stops animating under reduced motion. The
X banner is not an artwork or homepage hero. `/#purpose`, `/#traditions` and
`/#collecting` resolve to focusable headings; the header links to the last two.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm --filter @katha/web exec node --test --test-isolation=none tests/*.test.ts
pnpm --filter @katha/web build
pnpm --filter @katha/web test:artwork-page
pnpm format:check
```

Model tests verify request bounds, response order/identity, strict private-data
rejection, emptiness and safe failures. Tests render the actual component to verify
semantics, links, text escaping, culture, safe photography and missing images.
Synthetic production HTTP checks exercise populated, empty and unavailable homepage
states and canonical metadata alongside existing artwork, catalogue and artist routes.

For manual browser review, run the migrated API and web services. Inspect `/` at
narrow and wide widths, keyboard navigation to the anchor headings, artwork/artist
links, uncropped photographs, long titles, photo failure, and empty/unavailable
catalogue states. Draft-only fixtures do not populate published works. No publication
gate should be bypassed to obtain a screenshot. Screenshots and reports stay local.
