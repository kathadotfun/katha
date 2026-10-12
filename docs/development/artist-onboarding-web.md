# Artist onboarding administration

Open `/admin`, connect a compatible Solana wallet in the header, and sign in to
Katha. The route initially renders only a public sign-in explanation. It has
`noindex` metadata and never embeds artist data, tokens or authority lists in
server-rendered HTML. The API remains the authorization boundary; hiding forms
in the browser is a usability guard, not access control.

## Setup and permissions

Run the documented [local services](local-services.md), migrate the database,
and start the API and web application. Configure the ignored server environment
with the operator's **public wallet addresses**, then restart the API:

```dotenv
KATHA_ADMIN_WALLETS=
KATHA_VERIFIER_WALLETS=
```

Set `KATHA_PUBLIC_API_ORIGIN`, `KATHA_PUBLIC_APP_ORIGIN` and `KATHA_CLUSTER`
consistently with the [wallet sign-in configuration](wallet-sign-in-web.md).
An empty role list grants no access. Do not copy private keys or bearer tokens
into configuration, Git, forms or documentation.

`GET /auth/permissions` authenticates the current bearer session, checks its
cluster, and returns the strict shared `walletPermissionsSchema`:
`{ session, admin, verifier }`. The two booleans describe only this wallet's
current server-configured permissions. The endpoint exposes no allowlists, chain
roles or other wallets, uses `Cache-Control: no-store`, and returns 401 without
an authenticated session and 403 for a mismatched cluster. It does not grant
permission, modify a session or read Registry configuration.

The page checks access after sign-in. Admin permission exposes creation; verifier
permission exposes saved-profile review and manual approval. Both roles must be
configured explicitly for an operator doing both. A signed-in collector sees a
denied explanation. Unavailable checks show a retry control and no forms. Each
protected read/write independently rechecks the session and required role in the
API; an earlier permissions response cannot authorize later requests.

## Create an artist

1. An administrator fills the display name, unique public slug, biography, region
   and one or more art traditions, one per line. Use approved public information.
2. Optional public links use one HTTP(S) URL per line. The image URL is stored as
   a reviewed public reference; this form neither uploads nor fetches its bytes.
   Credential-bearing URLs and private evidence, contacts or tokens are unsuitable.
3. Creator and payout wallets are optional, independently validated nonzero Solana
   public addresses. A profile can exist with neither; future sale eligibility
   requires an approved payout wallet. These fields do not prove wallet control.
4. Choose **Create artist**. Shared Zod contracts validate the fields;
   errors appear beside fields and focus moves to the first invalid field. The
   form keeps its inputs on failure and disables competing actions during writes.
5. `POST /admin/artists` returns the saved `UNVERIFIED` profile and server UUID.
   Review the saved values and give that UUID to an authorized verifier.

Creation is an off-chain HTTP write and does not request a Solana transaction
signature. Duplicate slugs return 409 without updating an existing profile. If a
network failure leaves the outcome uncertain, retry with the same slug; do not
change the slug merely to bypass a conflict. There is no automatic resubmission,
artist editing, listing, deletion or recovery queue in this step.

## Review and verify an artist

1. Under **Saved artists**, enter part of the artist's name or slug, or their
   record ID, and choose **Look up**. A name or slug lists matching artists
   (`GET /admin/artists?query=` for administrators, `GET /verifier/artists?query=`
   for verifiers), each with its record ID and a copy button; verifiers choose
   **Review** to open one. A record ID typed by a verifier opens the profile
   directly. Search returns identity fields only, never wallets.
   `GET /verifier/artists/:artistId` validates the UUID and returns an explicit
   `artistResponseSchema` projection, including unverified content. This read is
   protected by the same verifier middleware as manual approval; it is not a
   public artist lookup. Invalid/missing IDs return 400/404. Internal database
   columns and private evidence are excluded.
2. Review the saved name, biography, region, traditions, wallets and public URLs.
   A new lookup removes the previous target immediately, including on failure.
3. Complete manual artist verification outside the software. Select the explicit
   confirmation checkbox for this saved profile, then **Record verification**.
4. `POST /verifier/artists/:artistId/verification` sends only `{ confirmed: true }`.
   The server attributes the claim to the authenticated verifier wallet and supplies
   the timestamp. Concurrent/repeated approvals cannot overwrite the first approval.
5. The saved result shows verified status, verifier address and time, plus a link
   to the public artist profile. A timeout requires reloading the saved profile to
   resolve the outcome. Already verified profiles have no approval control.

This claim verifies the **artist profile**. It does not authenticate an artwork,
issue an on-chain attestation, mint an asset, or prove physical reality. Those
workflows are separate later steps. An administrator without verifier permission
cannot perform this approval.

## Session and request boundaries

The persistent header owns one browser wallet/session runtime. Sibling admin
views subscribe through `useSyncExternalStore`; streamed server pages remain
outside provider updates. Server snapshots are always empty. Bearer tokens stay
inside the session controller closure and are added only by its constrained API
methods. They are absent from React snapshots, storage, URLs and HTML.

Sign-out, expiry, wallet/account changes and disposal clear permissions, saved
profiles and form values. Abort signals and generation checks discard late
responses. The authenticated client checks permission-response identity, profile
UUID and verification attribution; mismatches fail closed. A 401 clears the
local session; a 403 removes the admin view's permissions and data. Error messages
map HTTP codes to fixed text and never render raw server responses. Reads/writes
use bounded deadlines, `no-store`, omitted cookies and rejected redirects.

Refresh requires signing in again. Roles may change after an access check, so the
server always rechecks them. Successful writes cannot be undone by aborting a
browser request; reload by the stable UUID or resolve creation by the unique slug.

## Verification

```bash
pnpm --filter @katha/web test
pnpm --filter @katha/api test
pnpm --filter @katha/shared test
pnpm db:test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
pnpm --filter @katha/web test:public-journeys
```

Synthetic tests cover separate roles, revoked sessions, safe errors, strict
contracts, form validation, duplicate submission guards and late responses.
Disposable PostgreSQL tests use real signed sessions to review persisted artist
records through the protected route. Chromium journeys exercise the actual admin
page, creation conflict/recovery, profile review, explicit verification, sign-out
and denied access at three widths, alongside all public journeys and axe checks.
No real artist data, wallet extension approval, transaction or deployment is used.

See [API authorization](api-authorization.md),
[artist management](artist-management-api.md),
[Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication),
and [React external stores](https://react.dev/reference/react/useSyncExternalStore).
