# NFC tag assignment and administration

A tag's public identifier is a canonical lowercase UUID, separate from a physical
chip's hardware UID. It references one permanent Katha artwork identity. Assignment
is an administrative record, not an authenticity, ownership or custody claim.
Basic NFC can be copied; the tag is a discovery bridge. Public tag redirects and
physical tag-writing instructions are implemented in later steps.

## Administrative routes

Every route requires an authenticated wallet session with the configured admin
role and cluster. Verifier-only sessions do not grant tag administration. Use the
existing [wallet sessions](wallet-sessions.md) and authorization setup. Responses
have `Cache-Control: no-store`; inputs use strict shared Zod contracts.

| Method | Path                                | Body / result                                                            |
| ------ | ----------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/admin/artworks/:kathaId/nfc-tags` | `{ "tagId": "aaaaaaaa-1111-4111-8111-111111111111" }`; assignment record |
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
neither publishes that draft nor exposes it through the public catalogue. There is
no tag-resolution route or frontend administration form in this step. Tag records
are not written to Solana, and no wallet transaction is prepared or signed.

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
new replacement tags remain bound to the permanent artwork.

Test identities and records are synthetic. This step does not write a physical
NFC tag, establish a hosted domain redirect, or claim physical authenticity.
