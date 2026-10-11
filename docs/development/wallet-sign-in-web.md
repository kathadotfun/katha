# Wallet sign-in and session handling

Connect a compatible Wallet Standard wallet, then choose **Sign in with wallet** in
the header panel. Connection shares an address; sign-in proves control of that
address by signing a message. Neither action approves a transaction or grants an
administrative role. The panel displays the configured Localnet/Devnet test network.

## Public configuration

The web server passes only validated public origins and the configured cluster
into the wallet provider. Set the same values on the API and web processes:

```bash
KATHA_CLUSTER=devnet KATHA_PUBLIC_APP_ORIGIN=http://localhost:3000 KATHA_PUBLIC_API_ORIGIN=http://localhost:3001 pnpm --filter @katha/web dev
```

Use your reachable LAN origins for a LAN demonstration. Next.js does not inherit
root `.env` loading from the API process. The API's `API_ALLOWED_ORIGINS` must allow
the exact browser origin; the signed URI must match `KATHA_PUBLIC_APP_ORIGIN`.
Defaults are localnet, `http://localhost:3000`, and `http://localhost:3001`.
Origin/domain or cluster mismatch fails before a wallet signature is requested.
Keep development clocks synchronized; future-issued or expired challenges fail.
Changing the app origin requires a fresh sign-in. Use HTTPS for hosted use; hosting
and mainnet remain outside the current local/Devnet sequence.

## Signing and API boundary

The existing [authentication API](wallet-authentication.md) issues a five-minute,
one-use nonce challenge. Shared `walletSignInMessage` reconstructs the API's exact
statement without changing its existing protocol. Before requesting a signature,
the browser checks the response schema, domain, URI, connected address, cluster,
nonce shape, issuance/expiry bounds and challenge ID. Extra lines, whitespace or
message replacement fail. The returned message is encoded as exact UTF-8 bytes.

The Kit plugin's `signMessage` action stays inside the wallet adapter. Only a
validated login challenge can reach it. The selected account must advertise message
signing; unsupported accounts show an explanation. Pending sign-ins can be cancelled.
A wallet rejection, network failure or invalid response gives a fixed retry message
without displaying wallet/server error contents. There is no automatic sign-in.

`wallet-session-api.ts` sends shared-schema JSON to `/auth/challenge` and `/auth/verify`.
It uses a ten-second timeout, caller cancellation, no cookies, no caching and no
redirects. The API validates the Ed25519 signature and atomically consumes the nonce.
The browser accepts only a matching address/cluster and a future session expiry of
at most 24 hours. A mismatch is discarded and its returned token is revoked.

## Session lifetime and sign-out

`wallet-session.ts` keeps the bearer token in a closure, separate from the public
`WalletSession` snapshot. It never writes a token to local/session storage, a cookie,
URL, React context value, rendered text or log. Reloading starts signed out and
requires explicit connection and sign-in again.

Sign-out clears the local session immediately while retaining the wallet connection.
Account changes, replacement by another wallet (even with the same address),
disconnection/revocation, cluster/provider changes and expiry also clear authority.
In-flight requests are aborted. A generation guard discards late responses, including
an account switched away and back. If a late successful verification returns a token,
the controller revokes it rather than restoring the session. Subscribers see the
cleared snapshot immediately; there is currently no authenticated page-data cache.
Future authenticated views must clear their data with the session identity.

Sign-out calls `/auth/logout` using the previous token in the Authorization header.
A 204 or already-invalid 401 completes revocation. If the API is unreachable, local
sign-out still succeeds and the panel reports that server revocation is unconfirmed.
The old server session remains subject to its fixed expiry; there is no background
retry queue or claim of offline revocation. A verification processed by the server
but interrupted before its token reaches the browser may also remain until expiry.
No session restore or renewal is attempted.

## Verification

```bash
pnpm --filter @katha/web test
pnpm --filter @katha/shared test
pnpm --filter @katha/api test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:public-journeys
pnpm format:check
```

Shared tests reject changed message fields, extra lines, wrong origins, expired/future
challenges and excessive lifetimes. Wallet tests verify exact signed bytes and reject
account changes during a signature. Controller tests cover account/wallet replacement,
cancellation, late responses, wrong sessions, expiry, rejected signing, safe failures
and immediate local sign-out when revocation fails. Existing API tests use temporary
in-memory Ed25519 identities to verify signatures, replay protection and revocation.

Browser tests register a synthetic Wallet Standard wallet and intercept synthetic
auth responses: rejected verification/retry, sign-in, sign-out and account switching
at 320/768/1440 pixels. Synthetic signature bytes are UI fixtures; API cryptographic
verification is tested separately. No real wallet/key, transaction or funds are used.
The complete public journey includes 57 full-page accessibility scans.

For manual review, approve a sign-in **message** in your own compatible wallet,
inspect the displayed session/cluster, switch accounts and sign out. This manual
extension approval is not claimed by automated tests. Transaction signing and submission use the separate
[review-and-approval lifecycle](transaction-lifecycle-web.md).

The integration uses the official [Kit wallet plugin message-signing action](https://github.com/anza-xyz/kit-plugins/tree/main/packages/kit-plugin-wallet).

The [artist administration screen](artist-onboarding-web.md) uses constrained
authenticated session methods; bearer tokens remain inside the session closure.
