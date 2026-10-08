# Manual custody and private fulfillment

`@katha/db` exports `custodyEvents`, `fulfillmentRequests`, their inferred
insert/record types and the associated enums. Both tables reference the permanent
artwork UUID. These are manual operational records; neither a delivery request
nor a custody entry establishes Core ownership or a successful chain transaction.

## Append-only custody observations

Each custody entry stores its generated UUID, artwork UUID, allocated revision,
previous/next physical states, custodian wallet, recorder wallet, evidence digest,
occurrence time and record time. It contains no name, address, contact information,
tracking reference or free-form private notes. Evidence files stay outside Git;
the stored SHA-256 digest must be lowercase hexadecimal. Wallet checks validate
text shape, with decoding and role authorization left to the later API boundary.

Supported states match the shared physical custody contract: `UNKNOWN`,
`KATHA_HELD`, `COLLECTOR_HELD` and `IN_TRANSIT`. The first observation starts at
`UNKNOWN` and ends in a held state. A held work can enter transit; transit can end
at either held state. A sale or listing does not perform any of these movements.
Custodian wallet identifies the actual custodian, including the handler during
transit; it does not assert the digital owner.

Omit `revision` when inserting. The database locks the artwork row, checks the
latest manual observation against the supplied `fromState`, and allocates the
next revision within the same transaction. Competing writes from the same prior
state cannot both succeed. Entries cannot be updated or deleted; correct a real
physical movement with another valid observation rather than rewriting history.
Occurrence times cannot move backwards or follow the entry's record time.
Failed inserts and rolled-back transactions do not consume revisions.

Query by artwork UUID and explicitly order by ascending revision. Manual revisions
are separate from Registry custody revisions used for on-chain resale scope.
Future receipt reconciliation/indexing must expose successful finalized Registry
observations separately; do not publish manual entries as finalized chain events.
The allocation workflow uses PostgreSQL's default `READ COMMITTED` isolation and
[row locks](https://www.postgresql.org/docs/18/explicit-locking.html). Keep
transactions short and use a consistent artwork lock order for multi-work changes.
Higher isolation levels require appropriate transaction retry handling.

## Private fulfillment requests

Requests have `DELIVERY` or `RETURN_TO_KATHA` kind, a requester wallet, recipient
name, at least one contact method, address lines, city, optional region/postal
code, uppercase country code and optional instructions. Courier, tracking
reference and handling wallet support manual coordination. All these fields are
private operational data, including tracking and internal handling information.

Requests start as `REQUESTED`. Valid changes are:

```text
REQUESTED -> APPROVED -> DISPATCHED -> RECEIVED
    |           |
    +-----------+----> CANCELLED
```

Approval, dispatch and receipt require a syntactically valid handling wallet.
The database does not authenticate that wallet or check the requester's live
ownership. Later protected APIs must verify requester/administrator sessions,
roles, current ownership and custody eligibility before acting.

Request identity, artwork, requester, kind and creation time cannot change.
Contact/address details remain editable until dispatch; dispatched or closed
request details are locked. Update `updatedAt` explicitly. Cancellation after
dispatch and reopening closed requests fail. Active approved/dispatched requests
cannot be deleted; requested or closed private rows may be removed without
deleting the artwork or custody history.

Status changes never insert custody events automatically. Record actual dispatch
or receipt observations explicitly and transactionally alongside the corresponding
request change when implementing coordination. A request marked received is a
manual claim, not evidence that a blockchain transfer delivered the painting.

## Public/private boundary

Public artwork and provenance responses must use explicit safe projections and
never join or serialize fulfillment rows. Keep address/contact details out of
metadata documents, custody evidence documents, logs and public Git history.
Private request access belongs to the requester and authorized coordinators;
storage in a separate table does not itself grant access control. These tables do not grant access; the authenticated API uses explicit private projections.

Inputs have database length bounds: recipient name 200 characters, email 254,
phone 40, one to five nonblank address lines of at most 200 each, city/region 120,
postal code 32 and instructions 2000. Email/phone checks enforce basic text shape;
they do not verify deliverability. Later shared HTTP validation must fully parse
and normalize inputs before storing them.

## Migration and verification

Review `0004_custody_fulfillment.sql`, its generated snapshot and journal. Custom
custody allocation/immutability and fulfillment lifecycle guards follow the
generated SQL; snapshots do not represent these triggers. Apply only through
the explicit commands in the [database guide](database-package.md), adding
forward migrations for future changes.

```bash
pnpm db:generate
pnpm --filter @katha/db typecheck
pnpm db:test
```

The disposable PostgreSQL tests cover concurrent observations through independent
pools, rollback and revision reuse, invalid transitions and stale states,
immutable history, chronological ordering, missing artwork links, private
fulfillment validation and status guards, locked dispatched details and custody
independence. Fixtures use synthetic contacts and addresses only. The development
database and real delivery information are never used.

[Custody and manual fulfillment API](custody-operations-api.md) prepares unsigned
custody attestations and exposes private owner requests/admin coordination. Manual
request status never creates finalized custody or transfers Core ownership.

## Immutable collector receipt claims

Migration `0014_collector_receipt_reports.sql` adds an append-only private claim
linked to a dispatched DELIVERY request. The reporter must match the original
requester. A trigger rejects edits, deletions, return/undispatched requests and
invalid timestamps; snapshots represent the table and constraints, not the custom
trigger. The API independently verifies current finalized Core ownership.

One claim per request survives operator status changes. Parent/request locks and
an idempotent insert handle concurrent reports. A report never inserts custody
history or condition inspection records. Store reads filter by requester for the
collector page; authorized operators retain their private queue. Only one open
DELIVERY per artwork/requester is accepted through the locked store, while exact
same-UUID retries remain idempotent. See the [delivery UI guide](delivery-web.md).
