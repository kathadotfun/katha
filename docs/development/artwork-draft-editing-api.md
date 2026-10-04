# Artwork draft editing

`PATCH /admin/artworks/:kathaId` edits a private draft using its permanent Katha ID.
It requires an authenticated admin session. The existing role guard runs before
path/body validation or persistence, and responses use `Cache-Control: no-store`.

## Request and response

Send JSON with an `expectedUpdatedAt` copied exactly from the last administrative
create/edit response, plus at least one content field:

```json
{
  "expectedUpdatedAt": "2026-10-05T00:00:00.123Z",
  "title": "Revised fictional artwork title",
  "story": "Approved synthetic documentation for this example.",
  "dimensions": { "heightMm": 300, "widthMm": 200 },
  "origin": { "countryCode": "NP", "region": "Patan" }
}
```

The timestamp above is an example. Use the actual record's UTC timestamp with
three fractional digits. Success returns `200` with the shared administrative
`ArtworkDraftResponse` and a new `updatedAt`. Keep the returned value for the next
edit; each accepted update advances it by at least one visible millisecond.

Editable fields are `title`, `dimensions`, `origin`, `technique`, `story`,
`meaning`, `culturalContext`, `creationProcess` and, before it is established,
`authorshipEvidenceHash`. Validation reuses the creation contracts and bounds.
Omitted fields retain their existing values. Nullable descriptions accept null to
clear them; title must remain nonblank. Materials and media remain separate later
workflows.

Dimensions are replaced as a complete group: supply height/width with optional
depth, or null to clear all three. Origin is replaced as a complete group: supply
an uppercase two-letter country code and optional region/locality; omitted locations
become null. Origin itself cannot be null. Evidence accepts a SHA-256 digest only;
once nonnull, the same digest may be retained but cannot be changed or cleared.

Caller-supplied UUID, Katha ID, artist, category, creator wallet, creation year,
creation request UUID, timestamps or lifecycle/private fields are rejected. The
response preserves permanent identity and attribution and omits the creation
request UUID and private storage columns.

## Editing window and concurrency

The store locks the artwork row in a transaction, checks the expected timestamp,
checks the editing window, then updates only explicitly allowed columns. Two
requests with the same token cannot both succeed. Stale requests return a conflict
without changing content, timestamps or category counters. Do not invent a new
timestamp to bypass a conflict; inspect the current administrative record first.
Administrative browsing interfaces arrive in their later workflow steps.

This endpoint stops editing once the artwork has a publication marker or any metadata version,
verification, condition report, custody event, blockchain operation, indexed
activity or ownership record. This includes draft documents and failed operations:
reserved or historical expectations must be reviewed through the appropriate
lifecycle workflow. Committed metadata changes belong to the later versioned
metadata revision workflow, which preserves documents and chain commitments; the
draft PATCH never rewrites those records or sends blockchain transactions.

The parent row lock also serializes new referencing lifecycle inserts through
PostgreSQL foreign-key checks. Future document/operation preparation must lock the
artwork before reading its content and deriving hashes, then persist those
expectations in the same transaction. A foreign key alone cannot validate a
previously computed document against current artwork content.

## Errors and verification

- `400 INVALID_REQUEST`: malformed path/content, empty edits, absent/invalid token,
  or attempted immutable/private field edits.
- `401 UNAUTHENTICATED` / `403 FORBIDDEN`: existing session/role boundary.
- `404 NOT_FOUND`: a valid permanent ID has no stored artwork.
- `409 CONFLICT`: stale timestamp, established evidence hash change or closed editing window.
- `500 INTERNAL_ERROR`: unexpected storage failure; driver details stay redacted.

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm db:test
```

Unit cases cover authorization before storage, strict partial contracts, full
measurement groups, empty edits, identity rejection, safe projection and failures.
The disposable PostgreSQL lifecycle uses a real signed session to check actual
content changes, preserved identity/dates, null clearing, stale and competing edits,
evidence immutability and draft/prepared/finalized metadata plus reserved-operation
locks. It leaves no test database/container or development data changes.

No migration or new dependency is required for editing. See
[draft creation](artwork-drafts-api.md),
[permanent identity constraints](artwork-identities.md), Drizzle's
[update behavior](https://orm.drizzle.team/docs/update), and PostgreSQL's
[row locks](https://www.postgresql.org/docs/18/explicit-locking.html).
