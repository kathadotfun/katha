# NFC tag assignment and administration

A tag's public identifier is a canonical lowercase UUID, separate from a physical
chip's hardware UID. It references one permanent Katha artwork identity. Assignment
is an administrative record, not an authenticity, ownership or custody claim.
Basic NFC can be copied; the tag is a discovery bridge. Public tag redirects are
read-only. See [tag writing and local/LAN demonstration](nfc-tag-writing.md) for
the manual hardware workflow and lifecycle acceptance checklist.

## Administrative routes

Every route requires an authenticated wallet session with the configured admin
role and cluster. Verifier-only sessions do not grant tag administration. Use the
existing [wallet sessions](wallet-sessions.md) and authorization setup. Responses
have `Cache-Control: no-store`; inputs use strict shared Zod contracts.

| Method | Path                                | Body / result                                                            |
| ------ | ----------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/admin/artworks/:kathaId/nfc-tags` | `{ "tagId": "aaaaaaaa-1111-4111-8111-111111111111" }`; assignment record |
| GET    | `/admin/artworks/:kathaId/nfc-tags` | `{ kathaId, items }`: every binding for the artwork, newest first        |
| GET    | `/admin/nfc-tags/:tagId`            | Active or retired assignment record                                      |
| POST   | `/admin/nfc-tags/:tagId/retire`     | `{}`; terminal retired assignment record                                 |

Use a new UUID for a new physical tag. The caller retains it while retrying a lost
response. Assignment returns 200 both initially and on an identical active retry.
A missing artwork/tag returns 404. A different artwork binding, a retired identifier,
or a second active tag for the same artwork returns 409. Invalid identifiers or
extra fields return 400; missing sessions return 401 and unauthorized roles return 403. Internal failures never expose storage details.

An assignment response has only `tagId`, `kathaId`, `state` (`ACTIVE` or `RETIRED`),
`assignedAt` and nullable `retiredAt`, with UTC ISO timestamps. It excludes internal
artwork IDs, actor wallet IDs, wallet addresses, evidence and fulfillment data.
Request logs omit tag identifiers and request bodies.

Administration can assign a tag to an existing draft before publication; this
neither publishes that draft nor exposes it through the public catalogue. The
**NFC tag** panel on the artwork's documentation page lists the artwork's tags
(active and retired), assigns a new tag, looks up any tag and retires the active
one after confirmation. The list returns at most 100 bindings and 404 for an
unknown artwork. Tag records are not written to Solana, and no wallet transaction
is prepared or signed.

## Public resolution

`GET /nfc/:tagId` requires no wallet session. `HEAD` has the same status and headers
without a response body. Its shared path schema accepts only canonical lowercase
UUIDs; the strict empty query contract rejects `url`, `next`, `origin` and all other
query fields. No caller-supplied redirect destination is accepted.

| Result                                               | HTTP behavior                                          |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Active tag bound to an eligible public artwork       | 302 `Location: <app-origin>/art/<katha-id>?source=nfc` |
| Unknown tag or binding that is not publicly eligible | 404 `NOT_FOUND`                                        |
| Retired tag bound to an eligible public artwork      | 410 `NFC_TAG_RETIRED`, no artwork ID or redirect       |
| Either failure, request `Accept: text/html`          | 302 `Location: <app-origin>/tags/<tag-id>`             |
| Invalid identifier/query                             | 400 `INVALID_REQUEST`                                  |
| Storage failure or corrupt identity                  | Sanitized 500 `INTERNAL_ERROR`, no redirect            |

`?source=nfc` only lets the artwork page word the visit as a tag arrival; anyone
can add it, and it proves nothing. A phone tap opens a browser, so an unusable tag
redirects browsers to the web page `/tags/<tag-id>` instead of showing JSON. That
page reads `GET /nfc/:tagId/status` and explains an unknown, retired or
not-yet-published tag (an active published tag redirects to its record). The
status response is `{ tagId, state, kathaId }`, where `state` is `ACTIVE`,
`RETIRED`, `UNPUBLISHED` or `UNKNOWN` and `kathaId` is present only for `ACTIVE`;
it never names an unpublished or retired binding's artwork.

All resolver responses have `Cache-Control: no-store`, including failures. A
**temporary** redirect lets later scans observe retirement or publication changes.
Previously opened artwork pages remain independent public records; retirement does
not withdraw an artwork or prove anything about its physical condition.

The destination origin comes from validated `KATHA_PUBLIC_APP_ORIGIN` at API startup.
Use `http://localhost:3000` for local development, or your web service's reachable
LAN origin for a phone demonstration. The owned canonical public origin is
`https://katha.fun`; selecting it does not deploy or host the application. The
resolver lives at the configured API origin (default `http://localhost:3001`). For
example, an API request to
`http://localhost:3001/nfc/aaaaaaaa-1111-4111-8111-111111111111` can redirect to
`http://localhost:3000/art/KATHA-PAUBHA-000001?source=nfc` when that synthetic binding exists
and is publicly eligible. Host/forwarded headers, stored document URIs, titles,
slugs and query parameters cannot change the destination.

Public resolution uses one database selection with the same publication predicate
as discovery and artwork detail: explicit non-future publication, authorship
commitment, verified artist, finalized verification and metadata, finalized initial
inspection and indexed ownership on the configured cluster. Draft, unverified,
unminted and wrong-cluster bindings return the same 404 as an unknown tag. Retired
private bindings also return 404. Only the tag ID, permanent artwork ID, retirement
time and a publication flag enter the internal public selection; administrative actors and private evidence
never enter it. These reads do not change custody, ownership or attribution.

## Persistence and replacement

Migration `0012_nfc_tags.sql` adds the NFC table and immutable-history trigger.
The public tag UUID is the primary key; artwork and actor wallet references are
foreign keys. A partial unique index permits one active tag per artwork. PostgreSQL
constraints and a trigger enforce these rules even for direct database writes:

- A tag begins active and its identifier, artwork binding, assigner and assignment
  timestamp never change. Existing immutable artwork identity supplies the Katha ID.
- Retirement records the actor and database timestamp; its time cannot precede
  assignment. Retired rows cannot change or reactivate, and tag history cannot delete.
- Retrying retirement returns the original retirement record without replacing its
  actor or timestamp. Concurrent assignments use database uniqueness rather than a
  process-local check; duplicate active retries retain the same original record.

Replace a damaged/lost tag by retiring its current identifier and assigning a new
UUID to the same permanent artwork. The old identifier stays reserved and retains
its historical binding. These are two explicit administrative actions; a failed new
assignment can leave the artwork temporarily without an active tag. Neither action
changes artist attribution, artwork title/ID, Core ownership or physical custody.

Apply the forward migration to the configured local development database before
using the API:

```bash
pnpm db:migrate
```

This command uses your ignored `.env`; testing below uses disposable synthetic data
and never applies migrations to the development database.

## Verification

```bash
pnpm --filter @katha/shared test
pnpm --filter @katha/api test
pnpm db:test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
```

Shared tests reject unsafe identifiers, extra actor/redirect fields, mismatched
lifecycle states and invalid retirement chronology. API tests cover authorization
for each route, input validation, safe response projection, missing/conflicting
records and sanitized failures. PostgreSQL tests apply the fresh migration twice,
exercise competing tags for one artwork and one identifier across two artworks,
verify simultaneous identical retries, and reject remapping, mutation, deletion,
reactivation, invalid relationships and pre-retired insertions. Retired history and
new replacement tags remain bound to the permanent artwork. Resolver tests cover
anonymous redirects, local/LAN/public origins, forged headers, arbitrary query
parameters, malformed/corrupt records, missing/retired tags, redacted errors and
HEAD/write-method behavior. Disposable PostgreSQL tests verify every publication
prerequisite, cluster isolation, retirement and replacement with real tag bindings.

Test identities and records are synthetic. This step does not write a physical
NFC tag, establish a hosted domain redirect, or claim physical authenticity.
