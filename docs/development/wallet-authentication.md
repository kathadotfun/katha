# Wallet authentication

The API authenticates Solana wallet message signatures through the existing
[wallet/challenge/session tables](wallet-sessions.md). It does not sign transactions,
read wallet keys, check artwork ownership, or assign administrative roles.

## HTTP contract

Shared Zod contracts live in `packages/shared/src/wallet-session.ts`. Auth routes
use strict JSON validation, the existing CORS/body limits, fixed errors, request IDs
and `Cache-Control: no-store` on all auth responses.

| Endpoint               | Input                                       | Response                                              |
| ---------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `POST /auth/challenge` | `{ walletAddress, cluster }`                | 201 `{ challengeId, message, expiresAt }`             |
| `POST /auth/verify`    | `{ challengeId, walletAddress, signature }` | 200 `{ token, session }`                              |
| `GET /auth/session`    | `Authorization: Bearer <token>`             | 200 `{ walletId, walletAddress, cluster, expiresAt }` |
| `POST /auth/logout`    | `Authorization: Bearer <token>`             | 204; permanently revokes the session                  |

The cluster must match configured localnet/Devnet. Wallet addresses must decode to
32 bytes through Kit, not merely match a text regex. `signature` is canonical
standard base64 encoding of the 64 signature bytes returned by wallet message
signing. Base64url, missing padding, invalid lengths and noncanonical encodings are
rejected. The wallet must sign the exact UTF-8 bytes of the returned `message`.
Do not prefix, reformat, normalize line endings or append a newline.

Verification uses the persisted message; clients cannot submit a replacement
message or domain. Malformed requests return 400 (or 415 for unsupported content
type); unknown, expired, used, mismatched or cryptographically invalid challenges
return the same fixed 401. Missing, malformed, expired or revoked bearer sessions
also return 401. Logout requires a currently valid session; subsequent attempts
return 401.

## Signed challenge

Each five-minute challenge contains:

- configured app origin as URI and its host/port as domain;
- wallet address and configured cluster;
- 32 random bytes encoded as a 64-character hexadecimal nonce;
- issuance time, expiration time, and generated challenge UUID;
- an explicit sign-in statement that grants no transaction authorization.

The server reconstructs this format and checks its SHA-256 digest before accepting
the signature. Kit imports the address as an Ed25519 public key and verifies the
signature over exact message bytes. This is an application message-signing protocol;
it is not a Wallet Standard `solana:signIn` implementation or transaction signature.
The future wallet interface can use `solana:signMessage` to sign these bytes.

The domain is derived from `KATHA_PUBLIC_APP_ORIGIN`, never from request Host or
Origin headers. The app authority must fit the existing domain constraint: DNS
names or IPv4, optionally a port, at most 253 characters. IPv6 app authorities are
rejected at configuration validation before listening. The API listener itself
still supports its configured IPv6 address. Changing app scheme/origin or cluster
invalidates previously issued sessions through message reconstruction/context checks.

## Atomic sessions and transport

After a valid signature, the store conditionally consumes an unused, currently
valid challenge and inserts a session in the same PostgreSQL transaction. Database
`clock_timestamp()` and existing triggers enforce time validity after locking,
so application clock skew cannot grant an expired/future challenge. Concurrent
verification yields at most one token. A failed insert rolls consumption back;
retrying a still-valid challenge can then succeed.

Sessions last 24 hours and are opaque tokens containing 32 random bytes encoded
as lowercase hex. Only their SHA-256 hashes are stored. The raw token is returned
once in the authorized verification response. Authentication hashes the supplied
token and checks unrevoked/unexpired persistence plus challenge domain, cluster,
origin and message commitment. Expiration is not extended by use. Logout stamps
permanent revocation through the existing trigger.

No cookie is set: clients explicitly send the bearer token in Authorization.
The planned web boundary should keep it in memory and clear it on sign-out; do
not put tokens in URLs, logs, public documents or browser persistence. Bearer
possession authorizes use until expiry/revocation, so use HTTPS outside trusted
local development. There is no ambient cookie credential or cookie-based CSRF flow.
Role enforcement remains step 055; signing in alone gives no admin/verifier power.

The store has no cleanup scheduler or rate limiting in this step. Expired records
are ineffective but retained; the service does not promise resistance to unbounded
challenge creation. Local/Devnet operator use remains the supported deployment.

## Verification

```bash
pnpm build
pnpm test
pnpm db:test
```

Unit tests cover real signatures from temporary in-memory identities, wrong
signers, message/domain/cluster/nonce changes, replay, concurrent verification,
clock bounds, session expiry, revoked/invalid tokens, strict schemas and secret
log omission. The disposable PostgreSQL runner verifies actual signed login,
concurrent one-use issuance, token-hash-only storage, wrong domain/cluster lookups,
failed-insert rollback followed by retry, database-authoritative expiry/future
rejection and logout. It never reads real `.env`, wallet key files or production data.

See the official [Kit signature utilities](https://github.com/anza-xyz/kit/tree/main/packages/keys)
and [PostgreSQL time functions](https://www.postgresql.org/docs/18/functions-datetime.html).
