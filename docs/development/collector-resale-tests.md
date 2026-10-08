# Collector-held inspection, resale and delivery tests

Run from the repository root:

```bash
pnpm test:e2e:collector
```

Use the pinned toolchains, running Docker, cached PostgreSQL/Core fixtures,
Surfpool and Playwright Chromium in the [primary journey guide](primary-journey-tests.md).
The runner owns a disposable database, local chain, storage, API and production
Next.js server. It uses synthetic artwork, evidence, contact details and temporary
wallets. It does not use the developer's environment, wallets, database or media.
Owned services are cleaned up after the run. No HTTP responses are mocked. Before preparing follow-up attestations, the
fixture waits for the actual chain clock to reach the saved report time. This
keeps the no-future-report validation intact when Surfpool trails wall time.

## Delivery and inspection

After the real onboarding and primary purchase, Wallet A requests private delivery.
An administrator approves the request and attests dispatch on chain before marking
it dispatched. A reports receipt through the collector interface. This private
report leaves the request dispatched and physical custody in transit; the test
compares provenance before and after receipt. Only the administrator's subsequent
custody attestation records collector-held custody, followed by manual fulfillment
completion.

A verifier records a post-delivery condition report. A requests resale inspection,
but this request and post-delivery report do not authorize a listing. Both the
disabled listing interface and a direct listing preparation request reject the
unapproved sale. The verifier reviews the inspection queue and attests a separate
pre-resale report scoped to A and custody revision three. Only then can A list.

## Resale and second delivery

Wallet B follows the permanent NFC URL, reviews a two-token secondary quote and
signs the purchase. Actual Core, Registry and token accounts verify the owner,
delegate lifecycle and [test settlement distributions](custody-resale-tests.md).
The sale changes digital ownership to B while physical custody remains with A.
Inspection coordination rejects this owner/physical-holder mismatch, and B cannot
read A's private delivery request.

Delivery from A to B uses the existing administrator's manual dispatch and receipt
custody attestations. The private delivery-request interface accepts Katha-held
works, so the test does not repurpose A's old request for this collector-to-collector
movement. Custody reaches revision five with B as physical holder. A's earlier approval is
then reported stale for B. The verifier
records a fourth condition version: a post-delivery report scoped to B and revision
five. Physical inspection and delivery remain manual outside this synthetic test.

## Preserved evidence and rejected actions

Independent account reads check every custody and condition milestone, permanent
attribution, the Core URI and immutable historical records. Public provenance ends
with two purchases, four condition attestations and five custody transitions.
Indexer replay creates no duplicate history, collections reflect B's ownership,
and NFC resolves to the same artwork URL throughout. Public detail, history and
application logs exclude the synthetic address, email, tracking and inspection notes.

The journey also rejects self-purchase, former-owner listing, quote reuse and access
to another collector's fulfillment request. These checks use real authorization and
transaction boundaries. This command extends the primary journey; the existing
`pnpm test:e2e` and `pnpm test:e2e:custody` commands retain their original scenarios.
It does not deploy to Devnet or perform the final manual demonstration.
