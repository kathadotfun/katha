# Collector collection page

Open `/collection` through **View my collection** on the account page or **My
collection** in the connected wallet panel. Connect and sign in through `/account`
first. The page requires a valid session, not an administrator role. Server HTML
contains no holdings or bearer token; page metadata disables search indexing.
The route reads the public wallet/API configuration at request time.

The [authenticated collection API](collector-api.md) supplies up to 20 published
indexed holdings per page, ordered by permanent Katha ID. Each work links to its
canonical artwork page and artist profile. Only approved public hero media can
appear; unavailable photographs have a text fallback. **Previous page**, **Next
page**, and **Refresh collection** read another observation, with bounded offsets.
A later empty page can return to the preceding page.

## Independent observations

- **Indexed digital owner** comes from finalized indexed Core activity. It can lag
  behind current Core ownership.
- **Physical custody** comes from finalized Registry attestations. Collector-held,
  Katha-held, in-transit, and unconfirmed states stay distinct from digital ownership.
- **Finalized listing observation** comes from the existing public listing lookup.
  Active, cancelled, expired, purchased, no listing, and unavailable are distinct.
  An expired active record can still require release. A listing never moves custody.
- **Indexing and Core owner check** show lag, missing history, stale observations,
  mismatches and unavailable reconciliation. Reaching the last observed finalized
  head is not a guarantee of live ownership.

The client validates artwork, Core asset and cluster bindings for listing responses.
If a listing lookup reports another owner, the page flags that conflict and keeps
its indexed-owner label rather than silently replacing the holding. Listing reads
are separate RPC-backed observations from the database collection snapshot and
may disagree during indexing delay. They are public requests with no bearer token.
A listing outage does not remove the artwork or pretend it is unlisted.

The page clears previous holdings on refresh failure, wallet/session change,
sign-out, expiry, or revocation. Requests are aborted and late responses discarded
when identity changes or the component unmounts. An empty collection is distinct
from an unavailable request and may reflect unpublished work or indexing delay.
No private fulfillment details, raw events, token balances or purchase controls
are added by this page. When a finalized listing lookup agrees with the indexed
owner and no ACTIVE listing requires release, **Offer this artwork for sale**
opens the [owner listing form](owner-listing-web.md). Eligibility is rechecked
during preparation and chain simulation.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:collection
pnpm format:check
```

Unit tests cover private transport, wallet/cluster scope, duplicate identities,
pagination, independent listing failure, listing binding, changed owners, delayed
responses and revoked sessions. The collection command shares the isolated account
browser harness: synthetic wallet/API responses only, no real signatures or keys.
It checks collection paging, Katha-held and collector-held states, indexing delay,
listing outages, retry and empty states at 375, 768 and 1280px, including axe and
overflow checks. Existing account and public SSR checks run in that same harness.
Screenshots stay in `/tmp`; real wallet approval remains manual.
