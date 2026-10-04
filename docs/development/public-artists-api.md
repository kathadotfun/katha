# Public artist profiles

`GET /artists` and `GET /artists/:slug` require no wallet session. Only manually
verified artist profiles are discoverable. Profile approval is an off-chain claim;
it does not authenticate an artwork or confer ownership, custody or sale eligibility.

## List

```bash
curl 'http://localhost:3001/artists?limit=20&offset=0'
```

The response is `{ items, pagination: { limit, offset, hasMore } }`. Each summary
contains `id`, `slug`, `displayName`, `region`, `traditions`, `profileImageUrl` and
`verificationStatus` (always `VERIFIED`). Images may be null.

Defaults are limit 20 and offset 0. Limit accepts canonical decimal integers
1–100; offset accepts 0–100000. Unknown parameters, duplicate parameters, leading
zeros and values outside these bounds return `400 INVALID_REQUEST`. Rows sort by
unique slug ascending; one additional row determines `hasMore`. There is no total
count. Offset pagination can shift when new profiles are approved between requests.

## Detail

```bash
curl 'http://localhost:3001/artists/fictional-artist'
```

Detail includes the summary fields plus `biography`, `publicLinks`, nullable
`creatorWallet`, UTC `verifiedAt` and `artworks`. Slugs are lowercase letters,
digits and single hyphen-separated segments, with a maximum length of 160.
Malformed slugs return `400 INVALID_REQUEST`; absent and unverified profiles
both return `404 NOT_FOUND`.

`artworks` is currently an empty array. Stored artworks can be unpublished drafts,
and artist approval does not publish them. The discovery endpoint now applies a
[publication predicate](artwork-discovery-api.md); related-artwork integration in
this artist response remains a later step.

Public schemas and SQL selections explicitly omit payout wallets, verifier wallet
identities, administrative timestamps, private evidence and fulfillment information.
Public links and biographies are intended public content; administrators must keep
private evidence out of those fields. Driver errors use the existing generic error
contract and redacted request logging.

## Verification

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm db:test
```

Unit tests cover anonymous access, pagination and slug validation, exact public
schemas, private-column projection, missing/unverified profiles and safe failures.
The disposable PostgreSQL case verifies filtering, slug order, adjacent pages,
nullable creator identity and omission of a stored draft artwork. It never uses
real artist data or the development database.

See [artist administration](artist-management-api.md),
[REST boundaries](api-rest.md) and Drizzle's
[partial selection and pagination](https://orm.drizzle.team/docs/select).
