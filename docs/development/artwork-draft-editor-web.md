# Artwork documentation editor

From `/admin/artworks`, choose **Document new artwork** or open an existing artwork
by its title. `/admin/artworks/new` creates a draft; `/admin/artworks/:kathaId`
loads saved documentation. Sign in with a configured administrator wallet. The
browser checks permissions before every operation and the server rechecks each
request. Verifier-only and collector wallets cannot access these records.

## Document and save

For a new work, supply the artist UUID from artist onboarding, category (`MANDALA`,
`PAUBHA` or `THANGKA`), title and creation year. The API validates the artist's
existence and copies its creator-wallet snapshot. Artist verification is separate;
unverified profiles may be documented. Review attribution carefully before creation.

Optional documentation includes story, meaning, cultural context, creation process,
technique, origin region/locality, dimensions, materials and an evidence digest.
Country code is two uppercase letters; the new form defaults to `NP`. Dimensions
are positive whole millimetres, with height and width required together and optional
depth. Empty measurements clear all dimensions. Materials are ordered individual
names, one per line, at most 20 names of 120 characters each. Blank materials clear
the list. Names cannot contain commas, line breaks or unsupported controls, and
must be distinct ignoring case. The shared schemas bound all descriptions.

Blank optional descriptions clear saved values. Enter approved public artwork
content only: keep private evidence, personal contacts and shipping details outside
this form. The evidence field accepts only a lowercase SHA-256 digest; once saved,
it cannot be replaced or cleared. The interface makes established evidence read-only.

Create assigns the permanent Katha ID. Saved artist, category, creation year,
creator-wallet snapshot and identity are displayed as immutable information.
Updates omit these fields entirely, even if form data is tampered with. Success
shows a saved confirmation and replaces the form with returned content and the
new concurrency timestamp. No action registers, verifies, mints or publishes a work.
Choose **Manage artwork media** on a saved work to open its
[upload, ordering and visibility workflow](artwork-media-administration.md).

## Retry and review

A new form generates a creation request UUID. Record it before creation. If the
response is uncertain, check the draft list first and reuse the same UUID when
retrying the same physical work. After reloading the page, paste the retained UUID
into the creation request field. Duplicate UUIDs return a conflict instead of a
second work. The application does not automatically retry writes or persist form
content in browser storage. Distinct UUIDs can represent same-titled works;
physical duplication is an operator review responsibility.

Save uses the exact last returned `updatedAt`. A conflict or uncertain save preserves
form input and pauses further writes. **Reload saved draft (discard unsaved changes)**
loads current content and editing eligibility before another attempt. Copy any
unsaved text you need before reloading. A successful server write can still happen
when its response is lost; cancelling the browser request cannot undo it.

Editing closes when publication or any lifecycle record exists, including prepared
or failed operations and draft metadata documents. Closed records remain readable
to admins with disabled fields. Eligibility shown by a read is a hint; the server
checks it again under the edit lock. Use the versioned lifecycle revision workflow
when available. Neither this hint nor the draft list status proves chain success.

Session expiry, account changes, sign-out and teardown discard operator state and
pending responses. Tokens stay in the existing in-memory closure. Server HTML
contains only a safe shell, with no draft data; admin routes are marked noindex.

## Protected read and material persistence

`GET /admin/artworks/:kathaId` returns `{ artwork: ArtworkDraftResponse, editable }`
with `Cache-Control: no-store`. Invalid IDs return `400`, unavailable records `404`,
missing or revoked sessions `401`, denied roles `403`, and unexpected failures a
redacted `500`. `artwork` explicitly projects documentation and the ordered material
names, never creation-request UUIDs, raw evidence or fulfillment data.

Creation accepts optional `materials`; PATCH accepts optional `materials`. An omitted
PATCH list preserves earlier rows; `[]` clears them. Create/edit/read responses
include material names, with `[]` when none are documented. Material writes share the artwork transaction and its timestamp/edit-window
checks. Insert failure rolls back all content and rows. The existing material table
is reused; no migration or new dependency is needed. Read locks keep parent content
and materials consistent with these writers. Lifecycle eligibility is rechecked
independently by the write boundary.

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

Tests cover bounds, immutable field exclusion, role checks, private projection,
material ordering/replacement/clearing and rollback, optimistic concurrency,
closed editing windows, stale responses, safe conflicts and browser recovery.
Browser tests use synthetic data and test login signatures; no artwork transaction
is signed or submitted. Real-wallet operator review remains manual.

See [draft creation](artwork-drafts-api.md), [draft editing](artwork-draft-editing-api.md),
[Drizzle transactions](https://orm.drizzle.team/docs/transactions), and React's
[form state reset behavior](https://react.dev/reference/react/useState#resetting-state-with-a-key).
