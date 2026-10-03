# Wallet, challenge and session persistence

The Node-only database package exports `wallets`, `walletChallenges` and
`walletSessions`, plus inferred select/insert types. Migration
`0005_wallet_sessions.sql` adds these tables and their lifecycle guards. Apply it
through the [reviewed migration workflow](database-package.md).

## Records and invariants

Wallet addresses are unique and immutable. Their base58 text shape is checked;
full Solana address decoding remains an application responsibility. Wallet records
confer no administrative role, artist attribution, or artwork ownership.

Challenges contain a wallet link, unique 64-character lowercase hexadecimal nonce,
domain, LOCALNET/DEVNET cluster, exact signed message, SHA-256 message digest,
issuance/expiry times and optional consumption time. Message size is limited to
4096 UTF-8 bytes, and PostgreSQL checks the hash against those exact bytes.
Expiry must follow issuance. Signed fields cannot change, and consumption is
allowed once, only within the validity interval. Consumption time comes from the
database clock, overriding caller-supplied timestamps.

The domain constraint checks basic text shape, including optional local ports.
The future API must validate the configured host, port and cluster and construct
and verify the complete message, including wallet, nonce and timestamps. The
database does not parse the signed message or verify signatures. Nonce generation,
cryptographic entropy, bounded lifetimes and HTTP authentication are implemented
with wallet authentication in a later step.

Sessions store only a SHA-256 digest of an opaque token, with a wallet link,
challenge link, immutable expiry and optional permanent revocation. The token hash
is unique. A composite foreign key binds the session to its challenge's wallet;
each challenge can create at most one session. Issuance requires a consumed,
unexpired challenge and future session expiry. Creation and revocation times come
from the database clock. Sessions may outlive the challenge used to issue them.

## Atomic issuance and lookup

After signature and message validation, the API must consume the challenge and
insert the session in one database transaction. A failed insertion rolls back
consumption. Competing consumers lock the challenge row: exactly one succeeds,
and a retry cannot reuse it. This persistence boundary alone does not authenticate
requests; database write access remains trusted.

Use the same transaction object for both writes:

```ts
await connection.db.transaction(async (tx) => {
  await tx
    .update(walletChallenges)
    .set({ consumedAt: new Date() })
    .where(eq(walletChallenges.id, challengeId));
  await tx.insert(walletSessions).values({
    walletId,
    challengeId,
    tokenHash,
    expiresAt,
  });
});
```

Generate the raw token securely in the authentication layer and return it only
through the authorized session channel. Never store it in database rows, URLs,
logs or public documents. Hash the presented token before lookup. A valid lookup
must require matching token hash, `revoked_at IS NULL` and
`expires_at > clock_timestamp()`, and validate the linked challenge's domain and
cluster against the request context. Unique token lookup alone is insufficient.

Revocation updates `revokedAt` once; the trigger stamps the current database time.
Sessions cannot be extended or unrevoked. Delete a challenge to cascade its session,
or delete a wallet to cascade all its challenges and sessions. These deletions do
not modify permanent artist or artwork records, which have separate identities.
Cleanup scheduling and HTTP access control remain later application work.

## Migration and verification

The migration includes reviewed custom trigger functions beyond Drizzle's table
snapshot. Preserve them during later generation. They use
[`clock_timestamp()`](https://www.postgresql.org/docs/18/functions-datetime.html)
for expiry checks after acquiring row locks: transaction-start `now()` could become
stale while waiting. Do not edit applied migrations; add forward migrations.

Run `pnpm db:test` with Docker running. Its disposable PostgreSQL database tests
unique addresses/nonces/token hashes, message integrity, invalid time bounds,
expired and future challenges, wrong-wallet sessions, concurrent replay,
transaction rollback, immutable fields, permanent revocation and cascading cleanup.
All data is synthetic. There are no API sessions or wallet signature endpoints yet.
