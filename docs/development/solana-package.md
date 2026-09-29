# Solana package boundary

`packages/solana` is the workspace boundary for Katha's Solana clients and
transaction builders. It currently contains only a buildable, environment-neutral
entrypoint. It stores no signing secrets and implements no cluster configuration,
RPC clients, signing, or transaction behavior.

## Build and check

```bash
pnpm --filter @katha/solana lint
pnpm --filter @katha/solana typecheck
pnpm --filter @katha/solana build
```

Build output and declarations are emitted to the ignored `packages/solana/dist`
directory. The planned implementation uses `@solana/kit` for browser and Node
clients; Kit dependencies and client configuration arrive with step 024.
