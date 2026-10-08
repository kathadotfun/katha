# Local primary collecting browser journey

Run from the repository root:

```bash
pnpm test:e2e
```

Use the pinned workspace and Solana toolchains, running Docker, the cached
`postgres:18.6` image, Surfpool, and Playwright Chromium. Browser installation
instructions are in [public browsing tests](public-browsing-tests.md).
The Core fixture uses the binary and SHA-256 pin documented in
[program testing](program-testing.md). A missing Core cache requires the existing
Devnet fixture download; it never deploys a program.

The command builds the applications, creates and migrates a disposable PostgreSQL
container on a random loopback port, loads Registry, Marketplace and Core into
an isolated Surfpool instance, and starts the production API and Next.js server.
It uses explicit synthetic configuration rather than the developer's `.env`,
database, uploads or wallets. Owned processes, temporary storage and the database
container are removed when the test finishes.

Three separate browser contexts act as administrator, verifier and buyer. A
temporary Wallet Standard transport signs exact challenges and prepared
transactions using in-memory test identities. Private keys never enter the
browser or repository. Application responses, simulation, transaction submission,
finalization and indexing use the real services; there are no HTTP response mocks.

The journey documents and verifies a synthetic Nepali artist, creates a Paubha
draft and approved photograph, registers and authenticates its permanent identity,
records a private condition inspection, attests Katha custody, initializes the
metadata commitment, mints and publishes the Core asset, and lists it for a primary
purchase. The buyer follows the actual NFC resolver's permanent artwork path,
reviews a quote and approves the purchase in the browser.

Independent RPC and API assertions check the buyer's Core ownership, retained
Katha custody, exact six-decimal token balances, the primary-sale provenance record
and replay without duplicate history. The test token, 250-basis-point commission
and 500-basis-point secondary royalty are simulation settings. The primary price
is 1,000,000 base units: 975,000 go to the artist and 25,000 to the treasury.

The harness explicitly initializes marketplace sale terms with its temporary
platform authority. NFC assignment uses the protected API because physical tag
writing is manual. The resolver points to the configured local application origin;
the test does not visit the hosted canonical domain or write a physical tag.
Synthetic inspection is an automated workflow fixture, not a physical authenticity
assessment. Resale and the manual Devnet demonstration are separate journeys.

The browser also verifies that an ordinary buyer cannot administer artists.
Private inspection images are denied through the public storage route. When artwork
detail omits its collection address, purchase preparation obtains the binding from
validated provenance. Identity, Registry PDA, Core asset, attribution and cluster
must match, and a blocked or conflicting network binding is rejected. Unit tests
cover this fallback and mismatched provenance. Settlement evidence validates the
closing revision against the listing creation revision plus one, while preserving
the creation revision in public sale history. Incorrect closing revisions fail closed.
Production wallet configuration is read at request time in the root layout so
prerendered routes cannot retain the build machine's endpoint or cluster defaults.
See [Next.js connection](https://nextjs.org/docs/app/api-reference/functions/connection).
