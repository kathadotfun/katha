# Administrative authorization

Wallet authentication establishes identity. Administrative permissions come from
trusted server configuration and are rechecked on every protected request; they
are never stored in the session or accepted from request bodies, query parameters,
headers, browser state, or database ownership projections.

## Local roles

Configure the ignored server environment:

```dotenv
KATHA_ADMIN_WALLETS=
KATHA_VERIFIER_WALLETS=
```

Each value is a comma-separated list of up to 32 distinct, nonzero Solana public
wallet addresses, without whitespace. Empty lists deny all access. Never put a
keypair, seed, private key, bearer token, or real environment file in Git. The safe
`.env.example` leaves both lists empty. Restart the API after changing either list;
existing sessions immediately use the newly loaded policy.

| Protected namespace           | Required permission                    | Intended operations                                         |
| ----------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `/admin` and `/admin/*`       | Explicit admin allowlist membership    | Artist onboarding, artwork drafts and manual administration |
| `/verifier` and `/verifier/*` | Explicit verifier allowlist membership | Manual authenticity/inspection approvals                    |

A wallet can be explicitly assigned both roles. Admin membership alone does not
grant verifier permission. The guards authenticate the current bearer session
first, require its cluster to match the server, and expose the authenticated
`walletSession` in the server route context. Missing/invalid/expired/revoked sessions
return the existing fixed 401; authenticated wallets lacking permission return
fixed 403. Protected responses use `Cache-Control: no-store`. Missing authorization
wiring also denies access. Health and wallet sign-in remain available without roles.

Both namespaces are reserved by middleware before future write handlers. The [artist management API](artist-management-api.md) now uses these guards for
creation and manual approval. Artwork write endpoints, role-management endpoints
and frontend administration remain planned. Future handlers must stay behind these guards and use
strict request schemas rather than accepting role or actor claims.

## Registry authority checks

API permission and chain signing authority are independent. Before preparing a
sensitive Registry operation, call `requireRegistryAuthority` with the bearer
header and the exact required field:

| Registry role           | Required API permission |
| ----------------------- | ----------------------- |
| `authority`             | admin                   |
| `registrationAuthority` | admin                   |
| `custodyAuthority`      | admin                   |
| `verifierAuthority`     | verifier                |

The guard first authenticates and checks the local permission, then freshly reads
the canonical config PDA at finalized commitment. The Kit reader checks account
existence, the reviewed Registry program owner, non-executable status, exact
allocation/discriminator, canonical config bump, collection-authority PDA/bump,
and nonzero role addresses before returning authorities. Only a matching wallet
passes. Reads are not cached and have a five-second abort signal. Missing config,
wrong authority, malformed accounts or RPC failures deny access with fixed 403;
provider errors and configuration values are not returned or logged.

This prevents an API allowlist from overriding the Registry. It also prevents a
chain authority from accessing private API administration unless explicitly
allowed by the operator. Off-chain content administration can operate before
Registry initialization; chain preparation remains blocked until config exists.
The program independently validates the transaction signer when a future connected
wallet signs an operation. An API session never authorizes the server to sign.

## RPC configuration

Omit both optional `KATHA_RPC_URL` and `KATHA_RPC_SUBSCRIPTIONS_URL` to use the
existing localnet or Devnet defaults. If customized, provide both. The existing
Kit endpoint resolver requires cluster-compatible HTTP/WebSocket protocols,
rejects embedded credentials/fragments and known mainnet/testnet endpoints. Devnet
requires HTTPS/WSS. Custom endpoint operators are trusted to serve the configured
cluster; these checks are not cryptographic cluster attestation. No program-ID
override or request-supplied endpoint is accepted.

Role lists and RPC settings stay outside the three-field public configuration
allowlist. `NEXT_PUBLIC_` aliases containing ADMIN, VERIFIER or RPC are rejected,
along with existing secret-marker aliases. There is no permission discovery or
public authority-list endpoint in this step.

## Verification

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm codegen:check
```

Tests exercise protected route namespaces including their roots and future nested
paths, rejected role/actor claims, distinct permissions, current session checks,
empty defaults, policy mutation isolation, exact chain roles, failed reads and
forged owner/address/type/size/bump/collection-authority fields. Synthetic encoded
Registry accounts use the generated codec; RPC fetches are mocked and their
finalized commitment/abort signal checked. These tests do not deploy or submit
transactions. Wallet signature/session persistence remains covered by the preceding
[authentication tests](wallet-authentication.md).

See [Hono middleware](https://hono.dev/docs/guides/middleware),
[Solana account reads](https://solana.com/docs/rpc/http/getaccountinfo), and
[Registry bootstrap](registry-bootstrap.md) for the underlying boundaries.
