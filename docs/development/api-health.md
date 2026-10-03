# API health and shutdown

The API creates one owned `@katha/db` pool after environment validation. Importing
modules never creates a connection; PostgreSQL opens lazily on the first query.
The API does not run migrations automatically.

## Health endpoints

| Endpoint            | Success                      | Unavailable                        |
| ------------------- | ---------------------------- | ---------------------------------- |
| `GET /health/live`  | 200, `{ "status": "alive" }` | Does not depend on PostgreSQL      |
| `GET /health/ready` | 200, `{ "status": "ready" }` | 503, `{ "status": "unavailable" }` |

Both return `Cache-Control: no-store` and a server-generated `X-Request-Id`.
These public probes expose only status, without URLs, credentials, SQL, driver
errors, schema details or private data. Readiness is an operational response,
not a domain error envelope. A valid configuration permits HTTP startup even
when PostgreSQL is unavailable; liveness can still be checked.

Readiness executes read-only `SELECT 1` against the owned pool. It proves database
connectivity, not migration completeness, application permissions, Solana
availability or indexer freshness. Apply migrations explicitly before using later
product endpoints.

Responses wait at most two seconds for the probe. Concurrent requests share one
underlying query, and a timed-out query remains shared until it settles; repeated
probes do not enqueue more database queries while it is pending. The underlying
driver retains its ten-second connection timeout. The HTTP deadline does not
cancel that query. After settlement the next request probes again, allowing
failure recovery without caching a stale successful result. Shutdown always makes
readiness unavailable, including when an earlier probe subsequently succeeds.

## Shutdown order

SIGINT and SIGTERM start one idempotent shutdown:

1. Mark readiness unavailable and stop accepting new HTTP connections.
2. Drain existing HTTP requests for up to five seconds, keeping the pool open for
   those requests. Close remaining HTTP connections if the deadline expires.
3. Close the database pool once. The driver has a five-second close timeout; the
   service allows up to six seconds for cleanup.

Repeated signals reuse the same shutdown. Successful cleanup exits normally.
A drain timeout, HTTP close failure, database rejection or cleanup timeout emits
only `server_failed` and exits nonzero, releasing remaining process resources.
Listener errors also trigger cleanup and a nonzero exit. Normal lifecycle logs
use the existing allowlisted logger. There are no upgrade/WebSocket endpoints in
this service; forced HTTP connection closure is scoped to its HTTP server.

The Node adapter uses `getRequestListener` with an explicitly owned HTTP server
so drain and forced connection closure have precise Node HTTP types. Adapter-level
failures also receive a generic response without raw exception output.

## Run and verify

```bash
pnpm --filter @katha/db build
pnpm --filter @katha/api dev
curl -i http://127.0.0.1:3001/health/live
curl -i http://127.0.0.1:3001/health/ready
```

Configure ignored `.env` as described in [API configuration](api-configuration.md).
Start PostgreSQL with `pnpm db:start` for a ready response. Stop the API with
Ctrl+C. Health probes make no application writes.

```bash
pnpm --filter @katha/api test
pnpm db:test
```

Unit tests cover liveness independence, readiness failure/recovery, shared hung
probes, deadlines, shutdown races, repeated signals, cleanup order and failures.
Startup tests use synthetic unavailable PostgreSQL configuration and both signals.
The disposable Docker runner also verifies actual PostgreSQL readiness, pool
closure, and SIGTERM termination after a running API has opened a connection.
It requires built workspace packages; run `pnpm build` first after a fresh checkout.
It does not read `.env` or touch the Compose database.

Implementation follows the official [Node HTTP shutdown API](https://nodejs.org/docs/latest-v24.x/api/http.html#serverclosecallback)
and [Postgres.js connection ownership and cleanup](https://github.com/porsager/postgres#teardown--cleanup).
