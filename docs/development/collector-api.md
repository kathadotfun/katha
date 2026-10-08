# Collector account and holdings API

These read-only routes require a valid wallet session from the configured localnet
or Devnet cluster. Connect and complete the wallet challenge flow described in
[wallet sessions](wallet-sessions.md), then send `Authorization: Bearer <token>`.
A wallet connection alone does not authenticate the request. Never put the token
in a URL. Responses, including errors, use `Cache-Control: no-store` and vary by
Authorization and Origin.

| Route                                       | Response                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /account`                              | Safe session information, `indexedArtworkCount`, and `evaluatedAt`              |
| `GET /account/collection?limit=20&offset=0` | Wallet and cluster, evaluation time, published artwork holdings, and pagination |

The server takes the wallet address from the verified session. Neither route
accepts a wallet override. Expired, revoked, missing, and wrong-cluster sessions
return 401. Collection queries reject unknown or duplicate parameters, negative
offsets, and invalid integers. The default limit is 20, maximum 100; offsets range
from 0 to 100000. Pagination includes `hasMore` and orders permanent Katha IDs.
An authenticated empty collection is a successful response with an empty list.

## What a holding means

A holding is a published artwork in the configured cluster whose indexed owner
matches the signed-in wallet. Drafts, unpublished work, unverified artists, and
records lacking the required finalized publication evidence are excluded. The
account count covers the same published, wallet-scoped projection; it is an
indexed count rather than a live Core balance.

Collection pages read artwork, ownership, reconciliation, and indexer status in
one read-only, repeatable-read database snapshot. Each result contains the public
artwork summary, deterministic Core asset address, owner wallet,
`ownershipSource: INDEXED_CORE`, physical custody, and `indexing` diagnostics.
The API validates Registry artwork and Core asset bindings against generated PDA
helpers, the collection binding, and the indexed ownership event. Invalid bindings
fail the response rather than presenting a fabricated holding.

Ownership can lag behind Core. The endpoint makes no live RPC request. It uses
the [provenance API's indexing rules](artwork-provenance-api.md): Registry, Core,
and Marketplace checkpoints, the frozen observed network head, and persisted
Core reconciliation. `AT_OBSERVED_HEAD` means matching recent observations at that
head; it does not guarantee ownership has remained unchanged since observation.
`LAGGING`, `GAP_DETECTED`, `STALE`, and `UNKNOWN` must remain visible to clients. Checks
older than 30 seconds or tied to a superseded ownership source are stale.
An ownership mismatch never silently rewrites the stored owner in this GET route.

Custody comes from the latest finalized Registry custody attestation. Without one,
it is `UNKNOWN`. A Core transfer changes digital ownership without changing
physical custody. The response omits fulfillment requests, shipping addresses,
private evidence, storage paths, bearer tokens, and raw event payloads. Only public
hero images are included. Neither route signs transactions or writes ownership.

## Verification

```bash
pnpm test
pnpm db:test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
```

Boundary tests cover wallet scope, expiry/revocation, cluster mismatch, invalid
bindings, bounded pagination, cache headers, privacy, and indexing status.
Disposable PostgreSQL coverage uses real temporary signed wallet sessions and
synthetic finalized events to verify published-only holdings, cluster isolation,
owner changes, unchanged custody, and stale reconciliation after transfer.
Collector account and collection pages are subsequent frontend steps.
