# Resale while physical artwork remains in Katha custody

From the repository root, run:

```bash
pnpm test:e2e:custody
```

Use the pinned toolchains, running Docker, cached PostgreSQL/Core fixtures,
Surfpool and Playwright Chromium described in the
[primary journey guide](primary-journey-tests.md). This command builds the
applications and owns a disposable database, local chain, storage, API and
production Next.js server. It does not use the developer's `.env`, wallets,
database or media, and cleans up owned services after the test.

The test completes the real onboarding and primary purchase, then uses a separate
Wallet Standard browser context for Wallet B. Wallet A lists the same Core asset
for two test tokens while the artwork remains continuously Katha-held. The listing
review reports that an additional collector-held inspection is not required.
Wallet B follows the same NFC artwork path, reviews the secondary quote and signs
the actual simulated purchase through the application. No HTTP responses are mocked.
Test identities are temporary; signing material stays outside the browser.

## Ownership and settlement

The test reads actual Core and token accounts independently from the browser.
While listed, A remains the Core owner and temporary freeze/transfer delegates
bind the listing. After purchase, B owns the asset, it is unfrozen and those
plugin authorities have returned to the owner. The listing ledger records two
completed sales and closing revision four; public resale history retains creation
revision three. The test-only adapter isolates Metaplex compatibility types.
See the [Core transfer delegate lifecycle](https://www.metaplex.com/docs/smart-contracts/core/plugins/transfer-delegate).

At the six-decimal test-token settings, the two-token resale distributes:

| Recipient           | Base units |
| ------------------- | ---------- |
| Wallet A seller     | 1,850,000  |
| Artist royalty      | 100,000    |
| Treasury commission | 50,000     |

After a one-token primary purchase and this resale, actual cumulative balances are
A: 10,850,000, B: 8,000,000, artist: 1,075,000 and treasury: 75,000 base units.
A and B each start with 10,000,000; artist and treasury start at zero.
The 250-basis-point commission and 500-basis-point secondary royalty are simulation
settings, not production commitments. Native SOL network fees are separate.

## Preserved physical state and history

The Registry artwork identity, verification, metadata head, condition head/current
report, custody head and latest custody transition are compared byte-for-byte
against their post-primary snapshots at listing and after resale. Custody remains
Katha-held at revision one. Public attribution, metadata and condition summaries
also remain unchanged. No shipping or delivery is inferred from either sale.

Finalized indexing preserves the earlier provenance entries and adds exactly one
secondary purchase on its Core transfer. Replaying the indexer leaves the timeline
unchanged. Private inspection notes are absent from public history. A no longer
has the work in its collection; B does. NFC still redirects to the identical
permanent artwork URL after both transfers.

## Rejected actions

The previous primary seller cannot create A's listing, including through an
administrator wallet. A cannot request a quote to buy its own active offer. After
resale, the consumed quote cannot prepare another purchase, and A cannot list B's
asset. The final balance, owner, listing and history assertions follow these
rejections, detecting any partial settlement or extra sale.

These are automated synthetic workflow checks. Physical authentication, tag
writing and delivery remain manual. Collector-held inspection/delivery and the
manual Devnet demonstration are separate steps. The existing `pnpm test:e2e`
command continues to run only the primary journey.
