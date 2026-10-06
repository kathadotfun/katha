# Wallet Standard connection

The header's **Connect wallet** control discovers wallets through the Kit Wallet
Standard plugin. Connection is an explicit user action. It shares a public account
address; it does not authenticate a session, grant an admin role, sign a message,
prepare a transaction or send funds. Public browsing continues without a wallet.

## Packages and boundary

Compatible pins verified on 2026-10-06 against npm metadata:

- `@solana/kit` 8.4.0, matching the existing Solana package.
- `@solana/kit-plugin-wallet` 0.20.0, compatible with Kit ^8.2.0 and existing React
  19.3.0. Its React binding peer is optional; this boundary uses React's native
  external-store subscription rather than importing its hook binding. pnpm may
  resolve the optional binding transitively; the lockfile records that resolution.

The installed [Kit wallet plugin](https://github.com/anza-xyz/kit-plugins) uses
[Wallet Standard discovery](https://github.com/wallet-standard/wallet-standard).
There are no wallet-specific adapters, EVM injection, embedded wallets or new
legacy/Umi types. Manifests and pnpm lockfile pin the compatible installation.

`lib/wallet-connection.ts` creates a Kit `walletSigner` client only when the browser
provider mounts. RPC/signing operations are not exposed. It disables persistence
(`storage: null`) and automatic reconnection (`autoConnect: false`). The adapter
projects stable observable snapshots to the UI: wallet IDs/names, selected public
address, authorized account choices and supported v0/v1 transaction capabilities.
Opaque wallet handles and signer methods remain inside the adapter. Wallet icons
are not rendered; names are escaped React text and bounded to 80 characters.

Account addresses must decode to 32 bytes through Kit and match the supplied public
key. The selected account must belong to the wallet's authorized list and advertise
the configured Solana chain. Invalid, revoked or wrong-network accounts cannot be
presented as connected. Account changes, disconnection and wallet unregistration
update the snapshot. Registry listeners are removed and the Kit client disposed
when the provider unmounts or its configured cluster changes. The provider wraps
only the persistent header; server-rendered page streams remain outside its
connection state updates.

`WalletSession` remains the shared authenticated API session contract. Only its
cluster type is reused here; a connected address is never fabricated into a session.
Wallet authentication and transaction lifecycle controls follow separately.

## Configuration and use

The server layout validates `KATHA_CLUSTER` as `localnet` or `devnet` and passes
that public selection to the browser provider. Default is localnet. It never reads
or exposes private RPC configuration, API role allowlists or database credentials.
Wallets that do not advertise the selected chain are not offered; there is no
mainnet fallback. Use the same cluster as the API before adding authenticated flows.

Next.js does not automatically inherit the API command's root `.env` loading. For a
Devnet connection demonstration, supply the public web configuration explicitly:

```bash
KATHA_CLUSTER=devnet KATHA_PUBLIC_API_ORIGIN=http://localhost:3001 pnpm --filter @katha/web dev
```

Use the correct reachable API origin for your existing local/LAN setup. The connection
itself does not contact an RPC or require a funded wallet. A wallet needs to advertise
`solana:localnet` to appear in localnet mode; otherwise select the explicitly configured
Devnet demonstration. This changes wallet discovery, not the API or program deployment.

1. Open Connect wallet. A loading state waits for discovery; an empty list explicitly
   says no compatible wallet was found. Katha does not install or auto-open wallets.
2. Choose a discovered wallet and approve or reject its connection request in your
   wallet. Pending controls are disabled. Wallet-specific errors are replaced with
   a safe retry message; their contents are never printed or displayed.
3. Once connected, inspect the wallet name and full public address. If the wallet
   authorizes multiple compatible accounts, choose one through the labelled select.
4. Disconnect through the same panel. A revoked account or unregistered wallet also
   removes its displayed identity. Refreshing requires a fresh explicit connection.

The panel is an inline disclosure with an expanded-state button, labelled heading,
status/alert feedback and native buttons/select controls. It does not hide browsing
behind a modal. Wallet addresses wrap at narrow widths. No signer, session token or
private key is serialized, stored in browser storage, logged or included in Git.

The boundary checks version support by set membership (`has(0)` / `has(1)`) rather
than assuming every wallet supports newer transactions. A legacy/read-only account
can connect, but the panel states when versioned transaction support is absent.
Actual transaction version selection, simulation and wallet signatures belong to
the subsequent transaction step; this step never calls a signing feature.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/web test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:public-journeys
pnpm format:check
```

Unit tests exercise connection, authorized account selection, unsupported accounts,
wrong networks, invalid address/public-key pairs, revocation, version capability
changes, rejection sanitization, busy/disposed actions, cleanup and inert SSR behavior.
Browser tests register a synthetic Wallet Standard wallet after discovery starts:
no-wallet state, rejected approval/retry, connection, account selection, disconnect,
reconnection, wallet unregistration and refresh are tested at 320/768/1440 pixels.
The synthetic signing methods fail if called; tests assert zero signing calls.
Full-page accessibility scans include open unavailable and connected panels.

The browser fixture is test-only and uses public synthetic addresses. No real
extension approval, message signature, chain transaction or private key is used.
A manual extension connection can be reviewed locally by the user; it is not claimed
by the automated checks.
