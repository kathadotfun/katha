# REST boundaries

The API installs its request-ID/error boundary first, then restricted CORS and
body limits, before routes. The [content API reference](content-api-contracts.md)
lists installed health, wallet, content and document routes and their shared schemas.

## Shared contracts and validation

`@katha/shared` exports the error catalog, strict error response schema,
`HTTP_LIMITS`, pagination request/response schemas, and a paginated response schema
factory. The API selects fixed status/message pairs from that single catalog.
New boundary errors are `PAYLOAD_TOO_LARGE` (413) and `UNSUPPORTED_MEDIA_TYPE` (415).
Other validation failures use `INVALID_REQUEST` (400), without Zod issues, raw
input, stack traces or private details in responses or logs.

Handlers call `parseParams(context, schema)`, `parseQuery(context, schema)` and
`parseJson(context, schema)` before side effects. Parsers return inferred Zod
output types. Use shared strict object schemas to reject unknown fields. Query
parsing rejects repeated keys rather than silently choosing a value. JSON parsing
requires `application/json` (optional parameters such as charset are accepted);
malformed, missing or schema-invalid JSON is rejected. No implicit number coercion
is applied to payments: reuse `tokenAmountSchema` or `listingPriceSchema`, which
accept canonical integer decimal strings bounded by u64. JSON numeric amounts
are invalid, including seemingly safe small numbers.

## Pagination

List query conventions are `limit` and `offset`, both canonical unsigned decimal
strings at the HTTP boundary. Unknown keys are rejected by the base schema;
future filter contracts can extend its shape explicitly.

- Missing `limit` defaults to 20; accepted range is 1–100.
- Missing `offset` defaults to 0; accepted range is 0–100000.
- Whitespace, leading zeroes, signs, fractions, exponential notation, duplicate
  fields and out-of-range values are rejected.

Responses use `{ items, pagination: { limit, offset, hasMore } }` with numeric
pagination values. Installed list handlers use stable ordering and fetch at most `limit + 1` rows
to determine `hasMore`; they return at most `limit` items. Offset pagination does not promise snapshot stability
under concurrent updates. Artist lists and artwork discovery implement these conventions.

## CORS

Startup supplies only the already validated `KATHA_PUBLIC_APP_ORIGIN` and
`KATHA_PUBLIC_API_ORIGIN`. Matching is exact: schemes, hosts and ports must match.
A trailing slash, suffix lookalike, subdomain or `Origin: null` is rejected before
handlers run. No wildcard origin is enabled. Requests without Origin remain
available to CLI/native clients and server calls.

Allowed browser responses echo the approved origin, allow credentials and expose
`X-Request-Id`. Approved preflights return 204 with a 600-second max age. Allowed
methods are GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS; allowed request headers
are Content-Type and Authorization. Unsupported preflight methods/headers receive 403. Responses vary by Origin; preflights also vary by requested headers.

The testable app factory defaults to no permitted browser origins. Production
passes explicit configuration. CORS does not authenticate clients, validate wallet
sessions or replace authorization/CSRF defenses. Wallet sessions use explicit bearer authentication; [administrative/verifier guards](api-authorization.md) enforce their independent
configured roles. CORS does not create a session.

## Body limits

All routes cap actual body bytes before parsing, including requests without
Content-Length and requests whose declared length understates streamed bytes.
Malformed length headers receive 400; declared oversized bodies are rejected early.
Actual streamed bytes are checked independently of the declaration.

- Ordinary bodies, including JSON: 64 KiB.
- `multipart/form-data` bodies: 10 MiB, including fields and multipart overhead.

The bounded middleware buffers accepted bodies and reconstructs the request for
later parsers. On overflow it cancels the reader and returns a fixed 413. Limits
are per request, not a concurrency limit or rate limiter. Multipart allowance is
only a transport ceiling; it does not introduce an upload route, validate file
content or persist anything. Future storage endpoints must enforce field/file
count, type, per-file limits, visibility and authorization inside this ceiling.

## Verification

```bash
pnpm build
pnpm --filter @katha/shared test
pnpm --filter @katha/api test
pnpm lint
pnpm typecheck
pnpm format:check
```

Tests install synthetic routes only inside the test factory. They check validation
before side effects, exact integer amounts, safe errors, strict origins, credential
headers, preflight restrictions, unknown/duplicate query fields, pagination bounds,
streamed size limits, multipart boundaries and privacy. No test route is installed
in the real service.

See official [Hono CORS documentation](https://hono.dev/docs/middleware/builtin/cors)
and [validation guidance](https://hono.dev/docs/guides/validation). Body enforcement
checks actual bytes independently of Content-Length instead of relying on the
framework middleware's trusted-length fast path.
