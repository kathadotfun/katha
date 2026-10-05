# Public browsing and accessibility checks

The public browsing suite runs the production Next.js build with the existing
synthetic API harness. It tests the homepage, catalogue, artwork and artist pages
in Chromium at 320, 768 and 1440 CSS pixels. All browser requests are restricted
to the two temporary local origins; no real wallets, artist evidence, development
database, personal browser profile or external site is used.

## Tools and setup

The web package pins development-only `@playwright/test` **1.63.0** (Node >=20)
and `@axe-core/playwright` **4.13.0**, with `axe-core` **4.13.0** locked. The existing
Node 24.21.0 and pnpm 12.6.0 pins remain unchanged. No test library enters application
runtime code. Playwright supplies Chromium, browser locators and waiting assertions;
axe scans the rendered document, including computed styles.

From a configured workspace:

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/web exec playwright install chromium
pnpm --filter @katha/shared build
pnpm --filter @katha/web build
pnpm --filter @katha/web test:public-journeys
```

On a Linux machine missing browser system libraries, use
`pnpm --filter @katha/web exec playwright install --with-deps chromium` instead.
System dependency installation may require administrator privileges. The browser
must match the pinned Playwright release; an unrelated system Chrome is not used.
See [Playwright browser installation](https://playwright.dev/docs/browsers).

`test:artwork-page` retains its HTTP-only behavior. `test:public-journeys` runs those
same HTTP regressions followed by browser checks. Both start and stop their own
loopback API and production web processes on temporary ports; neither attaches to
an existing service. Build the web app after any source changes before running.
The CI workspace job installs Chromium/system dependencies and runs the browser
suite after its regular build and unit tests. It does not upload screenshots.

## Covered journeys

- Browse home → catalogue → Paubha filter → permanent artwork → original artist.
- Activate the first skip link with Tab/Enter; confirm visible focus and transfer
  to the single main landmark. Header navigation controls retain 44px height.
- Activate purpose/traditions anchors with the keyboard, including arrival from
  an artist page. Confirm target heading focus and preserved permanent routes.
- Check document language, nonempty title, one main landmark and one h1. Scan the
  complete page with axe without disabled rules or excluded regions.
- Check horizontal overflow at all three widths, including long unbroken title
  and biography fixtures. Repeat home with 200% root text size and reduced motion.
  Enlarged text is a reflow check, not a substitute for real browser zoom testing.
- Verify approved photo loading and `object-fit: contain`; abort an image request
  to exercise the hydrated unavailable-photo message.
- Follow unknown artwork → not-found/noindex → return home. Verify empty and
  unavailable catalogue filters and empty/unavailable homepage sections.
- Recover an artwork after a synthetic API outage with Try again. Error content
  and metadata stay generic and never expose upstream messages.

The fixtures contain only synthetic public records. A one-pixel PNG verifies image
loading/layout behavior; it is not sample artwork for the production catalogue.
Missing data is never replaced with invented artwork, prices or trust claims.

## Fixes protected by the suite

Native section anchors and a narrowly scoped homepage mount effect preserve focus
when the page is streamed. Main content permits long text to wrap at narrow widths.
Known public API failures retain descriptive artwork/artist fallback titles with
noindex metadata; genuine not-found signals still reach the missing-page boundary.
Try again reloads the current URL to obtain a fresh server read. Photos detect a
failed image after hydration as well as through their ordinary error handler.

## Artifacts and human review

Screenshots go under ignored `helper/build/reports/086/`; logs and generated browser
reports must also remain local. Do not stage browser binaries, synthetic screenshot
images, personal reports or helper guides. Only test source, pinned manifests/
lockfile, application fixes, CI and project documentation belong in Git.

Passing automated checks is not an accessibility certification. The
[Playwright accessibility guide](https://playwright.dev/docs/accessibility-testing)
recommends combining automation with manual assessment. Review keyboard and
screen-reader reading order, meaningful real-artwork alt text, browser zoom,
forced colours, real touch devices and other browser engines with approved media.
Inspect the cultural presentation and attribution using the actual artist's work;
synthetic screenshots establish layout and behavior only. No publication gate
should be weakened to populate a test page or obtain a screenshot.
