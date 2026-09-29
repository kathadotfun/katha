# Hono API service

The Node.js API lives in `apps/api`. It is a minimal Hono service using the
`@hono/node-server` adapter. At this foundation step it has no product routes, so
an HTTP request receives Hono's default not-found response.

## Run the service

From the repository root with the pinned Node.js and pnpm versions selected:

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/api dev
```

The service listens at <http://localhost:3001>. Stop it with `Ctrl+C`; the server
closes on SIGINT and SIGTERM.

## Check and build

```bash
pnpm --filter @katha/api lint
pnpm --filter @katha/api typecheck
pnpm --filter @katha/api build
pnpm --filter @katha/api start
```

`build` emits JavaScript to the ignored `apps/api/dist` directory, and `start`
runs that compiled entry point. Environment validation, readiness routes, request
handling, and product behavior are added in later steps.
