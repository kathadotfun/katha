# Artwork draft creation

`POST /admin/artworks` creates an unpublished artwork record. It requires a valid
wallet session and the configured admin role. Artist profiles may still be
unverified, and creator and payout wallets may be absent during documentation.
Creation does not authenticate, register, mint, publish or offer the artwork for sale.

Authorized administrators can also [browse unpublished artwork summaries](artwork-draft-list-web.md)
through `GET /admin/artworks`.

## Request

Send `Content-Type: application/json` and `Authorization: Bearer <session-token>`.
The minimal body is:

```json
{
  "creationRequestId": "aaaaaaaa-1111-4111-8111-111111111111",
  "artistId": "bbbbbbbb-1111-4111-8111-111111111111",
  "category": "PAUBHA",
  "title": "Fictional artwork for local testing",
  "creationYear": 2026
}
```

Use an actual stored artist UUID and generate a fresh UUID for `creationRequestId`
for each intended physical artwork. Keep that request UUID when retrying after a
network interruption. It is distinct from the server-generated HTTP request ID.
Reusing a creation UUID returns `409 CONFLICT`, even with different content, and
cannot create a second draft. Same titles are allowed for distinct works; this
boundary does not automatically recognize duplicate physical artworks.

Optional fields are `authorshipEvidenceHash`, `dimensions`, `origin`, `technique`,
`story`, `meaning`, `culturalContext` and `creationProcess`. Descriptive fields may
be omitted or null; supplied text must be nonblank, bounded and free of unsupported
control bytes. The evidence field accepts only a lowercase SHA-256 digest, never
raw evidence or private URLs. A committed evidence hash and creation year are
immutable under the existing database identity rules.

When supplied, dimensions require positive integer `heightMm` and `widthMm`, with
nullable/optional positive `depthMm`; each must fit PostgreSQL's signed integer
range. Origin requires a two-letter uppercase `countryCode`, with nullable/optional
`region` and `locality`. Omitting origin defaults to `NP` with null locations.
Materials and media are managed through their later workflows.

UUIDs normalize to lowercase. Categories are `MANDALA`, `PAUBHA` and `THANGKA`;
creation years range from 1 through 9999. Unknown keys are rejected, including
caller-assigned artwork UUIDs, Katha IDs, creator wallets, timestamps, verification,
publication, ownership, listing and custody claims.

## Response and persistence

A successful creation returns `201` with the shared `ArtworkDraftResponse`:
`id`, permanent `kathaId`, `artistId`, `category`, `title`, `creationYear`, nullable
`creatorWallet` and evidence digest, dimensions, origin, nullable descriptive fields,
and UTC `createdAt`/`updatedAt`. The creation request UUID and future private
storage columns are omitted through an explicit projection. The administrative
response has `Cache-Control: no-store`; drafts are absent from public discovery.

The database atomically allocates the category ID and copies the artist's creator
wallet. The insert and unique creation request claim share one transaction. A
losing duplicate rolls back its attempted insert and counter allocation; the API
returns an ID only after commit. Permanent identity, attribution and request UUID
cannot be overwritten. Historical rows retain a nullable request UUID.

Apply forward migration `0008_artwork_draft_requests.sql` using `pnpm db:migrate`
against the intended local database before running this endpoint. Earlier migrations
are unchanged. The migration adds a unique request UUID and an immutability trigger;
retain its custom SQL when generating subsequent migrations.

Existing drafts can be [edited through the admin PATCH endpoint](artwork-draft-editing-api.md)
while their documentation remains outside the lifecycle commitment workflow.

## Errors and verification

- `400 INVALID_REQUEST`: malformed content or caller-supplied privileged fields.
- `401 UNAUTHENTICATED`: missing, invalid, expired or revoked session.
- `403 FORBIDDEN`: authenticated wallet without the admin role.
- `404 NOT_FOUND`: the referenced artist does not exist.
- `409 CONFLICT`: duplicate creation request UUID or exhausted category capacity.
- `500 INTERNAL_ERROR`: unexpected storage failure, without raw driver details.

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm db:test
```

Unit checks exercise schemas, authorization before persistence, field projection,
input bounds and safe failures. Disposable PostgreSQL checks use a real signed
session, validate creator snapshots, duplicate/racing request rollback, concurrent
unique IDs, all categories, request immutability, capacity exhaustion and draft
exclusion from public artist pages. Tests use synthetic content and an owned
container; they do not open real environment files or the development data volume.

See [wallet authentication](wallet-authentication.md),
[artwork identity constraints](artwork-identities.md), and Drizzle's
[transaction](https://orm.drizzle.team/docs/transactions) and
[conflict handling](https://orm.drizzle.team/docs/insert) documentation.
