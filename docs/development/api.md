# Hono API service

The Node.js API lives in `apps/api`. It is a minimal Hono service using the
`@hono/node-server` adapter. It exposes liveness and database readiness probes. Other paths receive a JSON
not-found response with a server-generated request ID. See [API errors and logging](api-errors-logging.md).

## Run the service

From the repository root with the pinned Node.js and pnpm versions selected:

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/db build
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
Database readiness is implemented; product endpoints remain later steps.
