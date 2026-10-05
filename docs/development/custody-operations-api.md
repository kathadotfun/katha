# Custody and manual fulfillment API

These routes coordinate physical work separately from Core ownership, sale status
and finalized Registry history. All responses use `Cache-Control: no-store`.
Queries and unknown request fields are rejected by shared contracts.

| Route                                              | Access                                                 | Contract                          | Success                                |
| -------------------------------------------------- | ------------------------------------------------------ | --------------------------------- | -------------------------------------- |
| `POST /admin/artworks/:kathaId/operations/custody` | Admin allowlist and current Registry custody authority | `custodyPreparationRequestSchema` | `unsignedOperationResponseSchema`, 201 |
| `POST /fulfillment/artworks/:kathaId`              | Session and current finalized Core owner               | `fulfillmentCreateRequestSchema`  | `fulfillmentResponseSchema`, 201       |
| `GET /fulfillment/:requestId`                      | Original requester or configured admin                 | UUID path, empty query            | `fulfillmentResponseSchema`, 200       |
| `PATCH /admin/fulfillment/:requestId`              | Configured admin                                       | `fulfillmentUpdateRequestSchema`  | `fulfillmentResponseSchema`, 200       |

The custody authority is checked independently from verifier authority. Existing
administrative configuration uses the admin allowlist for custody-authority access;
verifier membership alone does not grant it. Sessions must match the server cluster.

## Unsigned custody preparation

After manually observing movement, prepare a custody operation:

```json
{
  "idempotencyKey": "synthetic-custody-initial",
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "expectedCustodyRevision": "0",
  "transition": {
    "action": "ATTEST_KATHA_CUSTODY",
    "from": "UNKNOWN",
    "to": "KATHA_HELD"
  },
  "collectorWallet": null,
  "movementConfirmed": true,
  "supportedTransactionVersions": [0]
}
```

The exact decimal-string revision is zero for initialization; otherwise it must
match the finalized head. The existing generated builders enforce the shared
transition graph, canonical accounts, authority, held/transit subject and version.
Collector destinations require a valid nonzero collector wallet; other destinations
require null. For minted works the API requires a collector destination to match the
current Core owner. The Registry remains an authority-signed physical observation
ledger; its custody instruction does not transfer Core ownership or encode that
additional API owner policy.

A bounded finalized [getMultipleAccounts read](https://solana.com/docs/rpc/http/getmultipleaccounts)
loads configuration, artwork, custody head, canonical bound Core asset and target
transition together. Invalid owners, sizes, discriminators, PDA relationships,
collections, artwork identities, custody subjects or occupied targets fail closed.
Local identity and draft timestamp are checked against registration.

Optional `fulfillmentId` links an existing private request. An approved DELIVERY
supports DISPATCH_FROM_KATHA; an approved RETURN_TO_KATHA supports
DISPATCH_FROM_COLLECTOR. A dispatched request supports its corresponding receipt.
The requester must still be the current Core owner. Save locks recheck request
status/timestamp and the artwork snapshot before recording pending operation intent.
Only request UUID/timestamp enter that intent; no contact, address, courier or notes.

The response contains one simulated unsigned transaction. Initial custody uses
`initialize_custody`; subsequent movement uses `transition_custody`. The authorized
wallet reviews and signs. Preparing a transaction never inserts custody observations,
changes fulfillment status or creates finalized history. Receipt reconciliation is
scheduled separately. Chain state may change before execution; revisions and authority
are rechecked by the program. Preparation reads do not reserve ownership or custody.

## Owner fulfillment requests

The request starts as REQUESTED and has no blockchain effect. DELIVERY requires
KATHA_HELD custody. RETURN_TO_KATHA requires COLLECTOR_HELD custody naming the owner.
Unminted works and transit are ineligible for owner requests.

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "kind": "DELIVERY",
  "recipientName": "Synthetic recipient",
  "contactEmail": "synthetic@example.invalid",
  "contactPhone": null,
  "addressLines": ["Synthetic address"],
  "city": "Synthetic city",
  "region": null,
  "postalCode": null,
  "countryCode": "NP",
  "deliveryInstructions": null
}
```

All contact/address fields are bounded; at least one contact method is required.
The requester comes from the authenticated session. Client-chosen request UUIDs
make identical retries reuse one record; changes to identity or submitted details
conflict. Artwork parent locks serialize writes. No list/bulk export endpoint is
added. The original requester retains access to their private request after sale;
other wallets require admin authorization.

## Manual status coordination

Admins explicitly confirm each manual observation:

```json
{
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "status": "APPROVED",
  "manualConfirmation": true
}
```

The legal sequence is REQUESTED → APPROVED → DISPATCHED → RECEIVED. Cancellation
is allowed from REQUESTED or APPROVED. The current Core owner must still match the
requester for approval/dispatch/receipt; cancellation permits closing stale requests.
Optional courier and trackingReference may be set before dispatch. Dispatched details
are locked, and closed requests cannot reopen. Optimistic timestamps and row locks
reject competing changes. Timestamps advance even for same-millisecond writes.

A manually marked DISPATCHED/RECEIVED request is a private coordination claim. It
never updates custody events or finalized chain history. Prepare the separate custody
attestation when recording an actual physical movement; its successful receipt is
reconciled independently. Receipt status is not proof of ownership transfer or delivery.

## Errors and privacy

Invalid inputs return 400, missing records 404, unauthorized sessions/roles 401/403,
and stale versions, incompatible custody, changed owners or conflicting retries 409.
Infrastructure errors are redacted. Public artwork/provenance queries do not select
fulfillment data. Private responses use an explicit projection and no-store; internal
wallet fields and chain intent are omitted. Keep real shipping data outside Git,
metadata, chain accounts, logs and public demonstrations.

Run `pnpm test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm format:check` and `pnpm codegen:check`. Tests use synthetic data and mocked
finalized RPC/simulation with real generated instruction encoding. Existing program
lifecycle tests cover authorized custody transitions. No live signing, submission,
physical delivery or Devnet deployment is performed by these endpoints or tests.
