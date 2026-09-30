# Solana client foundation

`packages/solana` is the shared boundary for Kit RPC clients and later
transaction builders. Step 024 pins `@solana/kit` 8.4.0 and
`@solana/kit-plugin-rpc` 0.19.0. The current client has RPC and subscription
capabilities but no payer, signer, or transaction-submission method. Wallet
connection, unsigned operation builders, and program clients arrive later.

## Clusters and endpoints

`createKathaRpcClient({ cluster })` requires `localnet` or `devnet`; there is no
implicit mainnet selection. The explicit defaults are:

| Cluster    | HTTP RPC                        | WebSocket subscriptions       |
| ---------- | ------------------------------- | ----------------------------- |
| `localnet` | `http://127.0.0.1:8899`         | `ws://127.0.0.1:8900`         |
| `devnet`   | `https://api.devnet.solana.com` | `wss://api.devnet.solana.com` |

Supply `rpcUrl` and `rpcSubscriptionsUrl` together for a local/LAN validator or
a Devnet provider. Devnet endpoints require HTTPS/WSS. Endpoint validation rejects
embedded URL credentials and known mainnet/testnet RPC hosts. An arbitrary custom
URL does not itself prove cluster identity; later transaction flows must verify
the connected cluster before wallet approval.

```ts
import { createKathaRpcClient } from "@katha/solana";

const client = createKathaRpcClient({ cluster: "devnet" });
const version = await client.rpc.getVersion().send();
```

## Transaction versions and account reads

`selectKathaTransactionVersion(cluster, walletVersions)` prefers v1 on Devnet
when the wallet advertises it, otherwise falls back to v0. The pinned Solana
4.1.2 local validator uses v0. A wallet without a compatible format fails
explicitly; it is never asked to sign a version it did not advertise. These
choices configure later builders; this package does not send transactions yet.
Solana documents [v1 activation and format support](https://solana.com/docs/core/transactions/versioned-transactions).

`FINALIZED_TRANSACTION_READ_CONFIG` sets `maxSupportedTransactionVersion` to the
numeric Kit-supported maximum (`1`) for later transaction/block reads, even if
outgoing transactions use v0. Solana's [RPC guidance](https://solana.com/docs/rpc/http/gettransaction)
requires this opt-in to read v1 activity.

`fetchOwnedEncodedAccount` fetches at finalized commitment and rejects a missing
account, address or program-owner mismatch, malformed encoded data, invalid
account fields, or data shorter than the caller's minimum length. Callers must
also decode and validate each program account's discriminator, PDA relationship,
and domain fields before trusting it. The Core adapter and Registry clients add
those checks in their own steps.

## Build and check

```bash
pnpm --filter @katha/solana lint
pnpm --filter @katha/solana typecheck
pnpm --filter @katha/solana test
pnpm --filter @katha/solana build
```

The tests use synthetic account responses and make no RPC calls to a live
cluster. Build output remains in the ignored `packages/solana/dist` directory.
