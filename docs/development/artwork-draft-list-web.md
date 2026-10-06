# Artwork draft administration

Open `/admin`, sign in with a wallet permitted by `ADMIN_WALLET_ADDRESSES`, and
follow **Artwork drafts** to `/admin/artworks`. The list displays unpublished works
with permanent Katha IDs, artist attribution, category, creation year, artist-profile
verification, documentation status and the last documentation update. Artist
verification is separate from artwork authenticity. Open a work’s title to review or edit its [structured documentation](artwork-draft-editor-web.md),
or choose Document new artwork.

## Access and recovery

The browser checks current session permissions before each page request. The API
independently authenticates and authorizes every read; verifier-only and collector
wallets cannot list drafts. Server-rendered HTML contains no draft data. Session
tokens stay in the existing in-memory session closure, never in page state or URLs.
Administrative responses and requests use `no-store`.

Pages contain at most 20 works in the interface. Use Previous/Next to browse and
Refresh to return to the first page. Loading clears earlier results; empty pages,
API outages and denied access have distinct messages. Sign-out, account changes,
expiry and component teardown cancel pending reads and clear operator data. Late
responses cannot restore an earlier session's results. An uncertain read can be
retried; this page has no write action or wallet transaction.

## Protected API contract

`GET /admin/artworks?limit=20&offset=0` requires `Authorization: Bearer <session-token>`.
Shared pagination defaults are 20/0, with limits 1–100 and offsets 0–100000. Invalid,
repeated or unknown query parameters return `400`. Missing/expired/revoked sessions
return `401`, disallowed roles `403`, and unexpected storage failures a redacted
`500`. Cookies and redirects are not used by the browser API client.

The strict shared response contains `items` and `pagination: { limit, offset,
hasMore }`. Each item contains only `id`, `kathaId`, `category`, `title`,
`creationYear`, `artist: { id, displayName, verificationStatus }`, `workflowStatus`,
`createdAt` and `updatedAt`. Timestamps are UTC ISO strings. Private evidence,
shipping information, document contents, wallet/session tokens and operation
payloads are excluded through an explicit database and API projection.

Only records whose `publishedAt` is null appear, including works with stored
lifecycle records. Results sort by creation time descending, then UUID descending.
A bounded lookahead determines `hasMore`; no total count is claimed. Offset pages
are not a snapshot: concurrent creation or publication can shift their boundaries.
Refresh to restart browsing. The offset cap bounds supported navigation.

`DOCUMENTING` means none of the following stored workflow records exist;
`LIFECYCLE_STARTED` means at least one metadata version, verification, condition
report, custody record, blockchain operation, ownership record or indexed event
exists. This matches the existing conservative draft-edit freeze boundary. Even
prepared or failed operations count. These labels do not prove a successful chain
transaction, minting, physical authenticity, or absence of chain registration.
Public discovery and publication requirements remain independently enforced.

## Verification

```bash
pnpm --filter @katha/shared test
pnpm --filter @katha/api test
pnpm --filter @katha/web test
pnpm db:test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:public-journeys
pnpm format:check
```

Tests cover role checks before persistence, private-field rejection, pagination
bounds, real PostgreSQL ordering and publication exclusion, lifecycle summaries,
revoked sessions, stale-response cancellation and safe recovery. Synthetic Chromium
journeys cover populated, next-page, empty, unavailable and denied states at three
widths with full-page accessibility checks. They use temporary test login signatures
and do not submit wallet transactions or modify development artwork records.

See [artist onboarding](artist-onboarding-web.md),
[draft creation](artwork-drafts-api.md), [draft editing](artwork-draft-editing-api.md),
and Drizzle's [projection and pagination documentation](https://orm.drizzle.team/docs/select).
