# Hono API service

The Node.js API lives in `apps/api` and uses Hono with the `@hono/node-server`
adapter. It provides health probes, wallet sessions, protected artist/draft and
canonical-document workflows, public content queries and approved storage delivery.
See the [content API contract reference](content-api-contracts.md) for installed
routes, schemas, roles, examples and privacy boundaries. Unknown paths receive a
JSON not-found response with a server-generated request ID. See
[API errors and logging](api-errors-logging.md).

## Run the service

From the repository root with the pinned Node.js and pnpm versions selected:

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/db build
pnpm --filter @katha/shared build
pnpm --filter @katha/solana build
pnpm --filter @katha/api dev
```

First copy the safe root `.env.example` to ignored `.env` and configure
`DATABASE_URL`. Startup validation fails before listening if required settings are
missing or invalid. The service defaults to <http://localhost:3001>, bound to
loopback; configure its listener explicitly for LAN use. See
[API environment and public configuration](api-configuration.md). Stop it with `Ctrl+C`; the server
drains HTTP requests and closes its database pool on SIGINT and SIGTERM. See
[API health and shutdown](api-health.md).

## Check and build

```bash
pnpm --filter @katha/api lint
pnpm --filter @katha/api typecheck
pnpm --filter @katha/api test
pnpm --filter @katha/api build
pnpm --filter @katha/api start
```

`build` emits JavaScript to the ignored `apps/api/dist` directory, and `start`
runs that compiled entry point. Environment validation and public configuration separation are implemented;
domain error responses, request IDs, and private-data-safe structured logs are implemented.
Database readiness and [REST boundaries](api-rest.md) are implemented.
[Wallet authentication](wallet-authentication.md) provides challenge, verification,
session lookup and logout routes. [Administrative guards](api-authorization.md)
protect [artist creation and manual approval](artist-management-api.md). [Public verified-artist queries](public-artists-api.md) are available without a wallet session.
[Admin artwork draft creation](artwork-drafts-api.md) allocates permanent IDs.
[Admin draft editing](artwork-draft-editing-api.md) preserves identity and rejects
stale, published or lifecycle-bound edits.
[Public artwork discovery](artwork-discovery-api.md) supports category filtering and
bounded pagination. [Public artwork details](artwork-details-api.md) expose approved
content, finalized summaries and explicit indexed ownership/freshness.

The [local storage provider](local-storage.md) supplies immutable validated bytes
for [canonical document preparation](document-preparation.md) and later media
workflows. Public delivery resolves approved metadata/media references; private
objects have no HTTP route.

[Artwork registration preparation](artwork-registration-api.md) now provides an
admin route with fresh Registry authorization and exact metadata/identity binding;
the signing wallet submits the returned unsigned transaction.

[Artwork verification preparation](artwork-verification-api.md) requires a current
Registry verifier, explicit manual authenticity confirmation, matching registered
attribution and exact prepared documentation. It returns an unsigned transaction
without creating finalized verification history or publishing the artwork.

[Condition attestation preparation](condition-attestation-api.md) selects initial,
unminted or minted condition instructions. Minted follow-up reports bind the current
Core owner and held custody revision in their hashed private document; execution
rechecks scope. Preparation does not finalize inspection state or approve resale.

[Custody and manual fulfillment API](custody-operations-api.md) prepares unsigned
custody attestations and exposes private owner requests/admin coordination. Manual
request status never creates finalized custody or transfers Core ownership.

[Artwork mint preparation](artwork-minting-api.md) exposes the protected atomic mint
builder with exact document/chain eligibility checks and one reserved idempotent
intent per artwork/cluster. Preparing an unsigned transaction does not publish or mint.

[Metadata commitment preparation](metadata-revisions-api.md) exposes authorized
unsigned initial, pre-mint and atomic post-mint metadata transactions with exact
stored-byte validation, reviewed version/hash checks and save-time eligibility guards.

[Finalized operation receipts](operation-receipts-api.md) now records verified signed
attempts and reconciles exact finalized transactions. No submission or event indexing
is performed by the receipt endpoint.

## Activity polling

The API codebase now includes an awaited finalized Registry/Core polling boundary
and `pnpm indexer:inspect`, a read-only two-stream diagnostic. See
[activity ingestion](chain-activity-ingestion.md) for setup, decoding guarantees,
page/consumer contracts and the explicit durable `pnpm indexer:run` worker. The
inspector command does not connect to PostgreSQL. Neither worker starts
automatically with the HTTP service.

Public provenance and condition history are available at
`GET /artworks/:kathaId/provenance`; see the [contract and indexing status guide](artwork-provenance-api.md).
