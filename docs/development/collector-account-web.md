# Collector account page

Open `/account` or choose **My account** in the header. The page uses Katha’s
existing visual tokens and Wallet Standard connection. No administrator role is
required. Wallet addresses and authenticated account data are loaded in the
browser; the server-rendered page contains no session or bearer token. The route
sets `noindex, nofollow` metadata.

1. Connect a compatible wallet using the header.
2. Choose **Sign in to Katha** on the account page and approve the login message.
3. Review your wallet name, full public address, configured localnet/Devnet cluster,
   session expiry, and published indexed artwork count.
4. Choose **Refresh account** to load another observation, or **Sign out** to clear
   the session. Use the header to switch accounts or disconnect.

An empty result says no published artworks are indexed for this wallet yet.
The count can lag behind Core and is not a live wallet balance. A failed request
clears the previous count and offers **Try again**. Revoked or expired access
returns the page to its signed-out state. Wallet/session changes abort pending
reads and discard late results. Refreshes cannot restore another wallet’s data.
Private errors and bearer tokens are not displayed or written to browser storage.

The page explains the configured six-decimal test-token simulation. It does not
load token balances, claim production USDC, or offer fiat settlement. Collection
browsing and purchase controls are subsequent features. It never prepares or
submits a transaction.

The typed session client calls the [collector API](collector-api.md) using a
no-store authenticated GET with omitted cookies, redirect rejection, and a bounded
request timeout. Shared schemas validate the response, and its wallet, cluster,
wallet record ID and expiry must match the active session. The controller uses
[React external-store subscriptions](https://react.dev/reference/react/useSyncExternalStore)
with an empty server snapshot and cleanup on unmount.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:account
pnpm format:check
```

The browser check requires the production build and uses isolated local services,
a synthetic Wallet Standard wallet, and intercepted API responses. It does not
connect to your API, use real keys, or prove a real wallet signature. It verifies
empty/populated counts, retry, revoked sessions, console errors, overflow, and axe
accessibility at 375, 768 and 1280 pixels. Screenshots stay under `/tmp`.
Unit tests cover strict transport, session binding and late-result disposal.
