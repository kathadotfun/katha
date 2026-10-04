# API environment and public configuration

The API validates its environment with Zod before constructing the HTTP listener.
`readServerConfiguration` accepts an explicit environment object, strips unknown
settings, and returns an immutable configuration object. Importing the module does
not read environment variables or start services. Only the entry point reads
`process.env`.

## Current settings

| Setting                   | Requirement/default                                 | Boundary                              |
| ------------------------- | --------------------------------------------------- | ------------------------------------- |
| `DATABASE_URL`            | Required PostgreSQL URL with host and database path | Server only; may contain credentials  |
| `NODE_ENV`                | `development` (default), `test` or `production`     | Runtime mode; does not enable mainnet |
| `API_HOST`                | `127.0.0.1` (default), `0.0.0.0`, `::1` or `::`     | Listener only                         |
| `API_PORT`                | Canonical integer text from 1–65535; default 3001   | Listener only                         |
| `KATHA_CLUSTER`           | `localnet` (default) or `devnet`                    | Safe to expose                        |
| `KATHA_PUBLIC_APP_ORIGIN` | Default `http://localhost:3000`                     | Safe to expose                        |
| `KATHA_PUBLIC_API_ORIGIN` | Default `http://localhost:3001`                     | Safe to expose                        |

Database URLs allow `postgres:` or `postgresql:` and reject fragments and surrounding
whitespace. Validation does not connect to PostgreSQL or establish readiness;
the running service owns readiness checks. Role wallets and optional paired RPC
endpoints are validated by the
[authorization configuration](api-authorization.md); storage/payment settings remain
planned.

Public origins must be absolute HTTP(S) origins, with no credentials, path,
query parameters or fragment. An optional trailing slash is normalized away.
They describe the configured demo services; they do not deploy `katha.fun`.
HTTP LAN origins are supported for the accepted local/LAN demonstration. Bind
`API_HOST=0.0.0.0` or `::` explicitly when LAN access is intended, and set the public
origin to the actual reachable host/port. Listener addresses are not substituted
for public URLs automatically.

## Startup and diagnostics

Copy the safe root `.env.example` to ignored `.env` and configure its development
values. Both API commands use Node's native `--env-file-if-exists=../../.env`,
resolved from `apps/api`; existing shell environment values take precedence.

```bash
pnpm --filter @katha/api dev
pnpm --filter @katha/api build
pnpm --filter @katha/api start
```

`dev` uses Node watch mode with the existing tsx loader. `start` executes compiled
JavaScript. Invalid settings produce a nonzero exit before a listener is created.
Diagnostics name only invalid settings, for example `DATABASE_URL, KATHA_CLUSTER`;
they omit values, Zod issue objects, driver details and validation causes.
Do not log or serialize the server configuration object. It contains the database
URL even though most fields are harmless.

## Public boundary

`toPublicConfiguration` constructs an immutable three-field object:

```json
{
  "cluster": "localnet",
  "appOrigin": "http://localhost:3000",
  "apiOrigin": "http://localhost:3001"
}
```

This explicit allowlist excludes the database URL, listener details and arbitrary
environment secrets. Do not spread `process.env` or the server object into browser
configuration. The API rejects `NEXT_PUBLIC_` setting names containing database,
password, secret, token or private-key markers as an additional misuse check.
This cannot classify every possible secret; safe exposure depends on the allowlist.
It also does not validate a separately configured Next.js process.

No public configuration endpoint or frontend wiring is added by this step. The
service exposes health and wallet authentication routes, with reserved protected
admin/verifier namespaces. Later REST contracts and frontend
API access will consume the allowed configuration without publishing server inputs.
Mainnet and testnet cluster values are rejected.

## Verification

```bash
pnpm --filter @katha/api typecheck
pnpm --filter @katha/api test
pnpm --filter @katha/api build
```

The main TypeScript configuration includes source/tests with Node types, so editor
and command-line checks agree. `tsconfig.build.json` emits only source into ignored
`dist`. Tests use synthetic values and an ephemeral loopback listener; they do not
read root `.env`, connect to the database or submit chain transactions. They cover
invalid settings, redacted errors, public allowlisting, failed startup before
listening, configured startup and SIGTERM shutdown.

API pins Zod 4.6.5 and Vitest 5.0.3, verified against package registry releases on
2026-10-04. Existing runtime and other workspace dependency pins remain unchanged.
Zod schema behavior follows the [official API documentation](https://zod.dev/api).

Wallet authentication derives its domain from the configured app origin. Its
authority must be a DNS name or IPv4 address, optionally a port, at most 253 characters
to fit existing challenge storage. IPv6 app origins are rejected before listening;
the API listener can still use IPv6. See [wallet authentication](wallet-authentication.md).

Server-only `KATHA_ADMIN_WALLETS` and `KATHA_VERIFIER_WALLETS` default to empty,
frozen allowlists. Optional `KATHA_RPC_URL` and `KATHA_RPC_SUBSCRIPTIONS_URL` must
be supplied together and fit the selected localnet/Devnet protocols. None are
included in public configuration. Public aliases containing ADMIN, VERIFIER or
RPC are also rejected. See [administrative authorization](api-authorization.md).
