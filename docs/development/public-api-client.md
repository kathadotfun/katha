# Public web API access

`apps/web/lib/public-api.ts` provides read-only artwork discovery/detail, artist
list/detail and provenance methods. Every successful JSON response is parsed with
its existing `@katha/shared` schema. Invalid identities and filters fail before
fetching. Pagination/filter inputs use the API's string query format, for example
`api.artworks({ category: "PAUBHA", limit: "20", offset: "0" })`.

Server Components should call `serverApi()` from `apps/web/lib/server-api.ts`.
This server-only module reads only `KATHA_PUBLIC_API_ORIGIN`, falling back to
`http://localhost:3001` for local development. Set that variable in the shell
running Next.js, or in an ignored `apps/web/.env.local`. Next.js does not load the
repository root `.env` automatically. An origin must use HTTP(S), without
credentials, a path, query or fragment. Do not put secrets in public URLs.

Build the shared package before running the web package directly:

```bash
pnpm --filter @katha/shared build
KATHA_PUBLIC_API_ORIGIN=http://localhost:3001 pnpm --filter @katha/web dev
```

The client sends GET requests with JSON acceptance, omitted credentials, disabled
caching and rejected redirects. It has no session, wallet or write methods and
imports no database/server configuration. A browser caller can instead construct
`createPublicApi(origin)` with an explicitly public origin; the API must allow the
app origin through its configured CORS policy. No server environment is exported
to the browser. Each request accepts an optional caller `AbortSignal`.

## Loading, errors and unknown data

Requests have a ten-second deadline covering both headers and body reading. A
bounded timeout override and fetch injection support tests. Failures are typed as
`PublicApiError`: `NOT_FOUND`, `UNAVAILABLE`, `INVALID_RESPONSE`, `TIMEOUT` or
`CANCELLED`. Upstream exception messages and HTTP error bodies are never exposed.
Empty validated lists remain empty; missing images/unknown lifecycle fields keep
their schema-defined values rather than invented artwork, authenticity or custody.

The root `loading.tsx` announces pending route data with a status message.
`error.tsx` offers a safe generic alert, retry and home link without rendering the
exception. `not-found.tsx` provides a home link for unresolved routes. They share
`PageState`, inherit the site navigation/footer and do not add a second main.
Future detail pages should translate only `PublicApiError` with `NOT_FOUND` into
Next.js `notFound()`; unavailable or malformed data must reach the error boundary.
Cancellation should be handled by the caller when fetching interactively.

The current homepage makes no API requests. These boundaries become active when
later pages suspend, fail or resolve missing records; this change does not add the
artwork page, catalogue or wallet flows.

## Verification

```bash
pnpm --filter @katha/shared build
pnpm --filter @katha/web test
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web build
```

Tests use Node's built-in test runner and synthetic fetch responses. They cover
origin validation, public request options, invalid inputs, endpoint-specific
response parsing, private/unknown fields, non-JSON responses, HTTP/network errors,
timeouts during fetch/body reading and pre-existing/in-flight cancellation.
Review the not-found page at an unknown URL and retry/error/loading behavior as
API-backed routes are implemented. No unavailable condition is described as
verified artwork data.
