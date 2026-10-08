# Collector-held inspection and resale

Sign in with the current Core owner wallet and open **Inspection and resale** from
`/collection`. The private route is `/collection/{kathaId}/resale`. Select
**Refresh inspection status** to load the observed finalized owner, physical custody,
latest report commitment, approval status and your own inspection requests.

A secondary sale of collector-held art requires Katha to inspect the physical
artwork. Select **Request Katha resale inspection** when offered. The request has
no wallet transaction and carries no grade, private evidence or self-approved
condition. Arrange the physical inspection with Katha manually. A basic NFC scan
or the collector's report does not replace the inspection.

## Request versus approval

Inspection requests are private immutable coordination records. Their scope is the
artwork, requester/current Core owner, custody revision and condition version
reviewed at submission. Identical retries and competing UUIDs for the same scope
reuse one request. A request for an earlier report remains preserved; a later
condition version allows a renewal request, including after approval expiry.

Approval is derived from the latest finalized Registry condition report, not a
mutable database approval flag. The collector view exposes these observations:

| Status         | Meaning                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `REQUIRED`     | A collector-held work needs the applicable pre-sale/pre-resale report.                                            |
| `APPROVED`     | The latest report matches the verifier, current owner/custody, reason and inspection validity.                    |
| `EXPIRED`      | A matching collector-held approval exceeded the configured inspection age.                                        |
| `STALE`        | The report's authority, scope, timing or Katha-held custody requirements no longer match.                         |
| `NOT_REQUIRED` | Continuous Katha custody satisfies the existing inspection rules; no fresh collector-held inspection is required. |

The Marketplace configuration controls validity; 30 days is the test default.
The inspection age is measured from physical inspection time, not request time.
An active listing must be released before another listing can be created even
when inspection approval remains valid.

## Verifier workflow

The authorized current Registry verifier opens
`/admin/artworks/{kathaId}/condition` and selects **Refresh inspection status** in
**Collector resale requests**. This shows a bounded recent request list, including
old owner/custody scopes for review. Stale requests cannot authorize the current
owner. Only the owner-scoped list is available to collectors.

Use the existing condition form below the request panel to record the actual
in-person inspection, evidence and report. For secondary collector-held resale,
choose PRE_RESALE. Review the current owner and custody scope, prepare the report,
then explicitly approve the verifier transaction in the wallet. Preparing a report
or transaction does not approve resale. Refresh the resale view after successful
finalization. Condition evidence and notes remain private.

## Listing and purchase

**Review a listing** is offered when the observed inspection requirements are met.
The existing owner listing screen also reads approval before enabling preparation
and rereads it on preparation. Missing, stale or expired approval blocks new
listings. Approval outages do not prevent cancellation or expiry recovery.

The server's existing transaction simulation and the Marketplace program recheck
eligibility on execution. Purchase also rechecks owner, custody revision, report
and inspection age. Separate finalized reads are observations, not reservations;
mismatched owner/artwork/report snapshots fail closed. The underlying RPC account
read boundary uses [finalized account reads](https://solana.com/docs/rpc/http/getmultipleaccounts).
A sale changes digital ownership without asserting physical delivery or custody.

## Private API and storage

| Route                                    | Access                                                     | Contract                                 |
| ---------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `GET /resale/artworks/:kathaId`          | Signed-in current Core owner                               | `resaleInspectionReviewSchema`           |
| `POST /resale/artworks/:kathaId`         | Current owner of secondary collector-held artwork          | `resaleInspectionRequestSchema` → review |
| `GET /verifier/artworks/:kathaId/resale` | Verifier allowlist and current Registry verifier authority | Review with recent request queue         |

Routes reject unknown query/body fields and return `Cache-Control: no-store`.
Request fields are `requestId`, `expectedCustodyRevision`,
`expectedConditionVersion` and literal `inspectionRequested: true`. A request
never changes ownership, custody, condition history or listing status. Request
lists are bounded to the most recent 100 records. They contain public wallet
identities and coordination timestamps, never private condition documents.

Migration `0015_resale_inspection_requests.sql` adds the scoped unique constraint,
wallet/version/revision constraints and custom immutability trigger. No private
request record belongs in public provenance or Git. Browser session changes,
sign-out, navigation and failed reads clear the displayed request state.

## Local verification

Apply the migration using the ignored local `.env` and configured `DATABASE_URL`:

```bash
pnpm db:start
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm db:test
pnpm --filter @katha/web test:account
```

Automated tests use synthetic artworks and wallets. They check request races,
renewal, protected queue access, approval expiry/scope, private-state clearing,
listing preparation and responsive/accessibility behavior. Manual physical
inspection and verifier wallet approval remain required for a real demonstration.
