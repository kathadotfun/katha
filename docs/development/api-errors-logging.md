# API errors and logging

Every request receives a fresh UUID v4 in `X-Request-Id`. Incoming IDs are ignored;
use the returned ID to correlate a response with the service logs. Error responses
also include that ID:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found."
  },
  "requestId": "b55d5929-a53d-4608-82d1-f6d91c1ba563"
}
```

| Code                     | HTTP status | Meaning                              |
| ------------------------ | ----------- | ------------------------------------ |
| `INVALID_REQUEST`        | 400         | Invalid request                      |
| `UNAUTHENTICATED`        | 401         | Sign-in required                     |
| `FORBIDDEN`              | 403         | Action not permitted                 |
| `NOT_FOUND`              | 404         | Resource unavailable                 |
| `CONFLICT`               | 409         | Current state prevents the operation |
| `PAYLOAD_TOO_LARGE`      | 413         | Body size limit exceeded             |
| `UNSUPPORTED_MEDIA_TYPE` | 415         | Unsupported content type             |
| `INTERNAL_ERROR`         | 500         | Unexpected failure                   |

The error catalog and response schema live in `@katha/shared`.
Handlers throw `DomainError` with an approved code. The boundary uses fixed
messages from the catalog, never the thrown message, stack, cause, or arbitrary
framework exception response. Unknown exceptions, including non-Error thrown
values, become generic 500 responses. These codes establish the error boundary;
authentication and authorization enforcement are separate features.

## JSON log contract

The logger emits one JSON object per line. Info goes to stdout; errors go to
stderr. Each record includes `timestamp`, `level`, and `event`.

- `request_completed`: server request ID, normalized method, status, nonnegative
  integer duration in milliseconds, and an approved error code when applicable.
  One record is written for each completed response; 500 responses use error level.
- `configuration_invalid`: fixed diagnostic and allowlisted setting names only.
- `server_started`: listener port.
- `server_stopping`: SIGINT or SIGTERM.
- `server_failed`: fixed event without exception contents.
- `transaction_observed`: request ID, localnet/Devnet cluster, and an explicitly
  supplied public transaction signature. This hook is for later operation handlers;
  it does not submit transactions or establish confirmation.

Request URLs, paths, query strings, headers, cookies, authorization, body content,
wallet sign-in signatures, environment values, database credentials, private
artwork evidence, and fulfillment data are omitted. The logger selects fields
explicitly instead of spreading input objects. Transaction identifiers must have
bounded base58 syntax; chain validation and finalized receipt verification remain
separate obligations. Never pass a wallet sign-in signature to this hook.

Log transport failures are swallowed to preserve application outcomes. This
minimal console transport has no buffering or recovery guarantees. Keep captured
logs outside Git; operational diagnostics should use request IDs and safe codes,
not copies of sensitive exceptions.

## Verification

```bash
pnpm --filter @katha/api test
pnpm --filter @katha/api typecheck
pnpm --filter @katha/api lint
pnpm --filter @katha/api build
```

Tests cover domain status mapping, unexpected and framework exceptions, non-Error
throws, private-input omission, unique concurrent IDs, rejected incoming IDs,
transaction field selection, configuration-name filtering, and logger failures.
Startup tests exercise invalid configuration and a temporary HTTP listener.
The factory installs the boundary without opening a socket; test routes exist
only in tests. Production exposes health probes but still has no product endpoints.
See [API health and shutdown](api-health.md) for readiness and signal handling.

The boundary uses Hono's [error and not-found hooks](https://hono.dev/docs/api/hono)
plus an outer middleware fallback for thrown non-Error values.
