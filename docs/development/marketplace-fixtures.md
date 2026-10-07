# Local marketplace settlement fixtures

Run the existing program harness from the repository root:

```bash
pnpm program:test
```

The harness now includes `marketplace-fixtures.test.ts`. Its reusable setup is
`packages/solana/tests/fixtures/marketplace.ts`. Each call starts a fresh in-process
LiteSVM using the pinned Registry and Core binaries from the existing
[program test harness](program-testing.md). It reads no developer `.env`, wallet
keypair, database, or configured external RPC. Test keys stay in memory.

## Explicit test configuration

| Setting                        | Fixture value                                                    |
| ------------------------------ | ---------------------------------------------------------------- |
| Network                        | Isolated localnet LiteSVM                                        |
| Transactions                   | Version 0, matching the existing program harness                 |
| Payment program                | Classic SPL Token, `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Payment mint                   | Fresh mint address returned by the fixture, six decimals         |
| Label                          | Katha local test token (no monetary value)                       |
| Buyer A and B                  | Each starts with 1,000,000,000 base units (1,000 test tokens)    |
| Seller, artist, treasury       | Separate wallets and zero-balance payment ATAs                   |
| Example price                  | 100,000,000 base units (100 test tokens)                         |
| Commission / secondary royalty | 250 / 500 basis points, simulation settings                      |
| Inspection validity            | 30 days, simulation setting                                      |
| Clock                          | 1,800,000,000 Unix seconds; inspection 60 seconds earlier        |

The mint has a temporary test mint authority and no freeze authority. It is not
USDC, NPR, a redeemable token or a deployed Devnet mint. The label belongs to the
test configuration; this step does not install token metadata. The fixed clock
makes inspection-age tests reproducible in later steps.

`@solana-program/token` is pinned as a test dependency at 0.17.0, verified from npm
at installation. Its `@solana/kit` peer range is `^8.3.0`, compatible with the
workspace's 8.4.0. Mint/account creation uses its Kit plugin and real classic Token
and Associated Token program instructions. Mint creation follows the
[official Solana mint guide](https://solana.com/docs/tokens/basics/create-mint).

## Artwork and failure fixtures

The setup creates two permanent Paubha identities and executes actual Registry
registration, verification, initial metadata and condition commitments, Katha
custody, and atomic Core minting. The Core collection is controlled by the Registry
collection-authority PDA. Both assets initially belong to the seller; artist
attribution and physical custody remain independent. Synthetic hashes and
`example.com` metadata URLs are test inputs, not hosted artwork documents.

Only initial SOL balances, a temporary Registry upgrade authority and the fixed
clock use direct simulator setup. Mint state, token balances, Registry lifecycle
records, collection and Core assets are created by program instructions.

The fixture also returns a different six-decimal mint, a nine-decimal mint, and a
funded buyer ATA for the wrong mint. Tests verify:

- correct mint program, authorities, decimals, supply and recipient ownership;
- distinct signer roles, Registry/Core binding, verification and physical custody;
- valid transfers down to one base unit;
- rejected unauthorized transfers/minting, wrong mint, wrong decimals and insufficient funds;
- rollback of an earlier valid transfer when a later instruction fails;
- exact bigint amounts above JavaScript's safe integer range.

The defaults are inputs for subsequent marketplace steps. This step does not
initialize Marketplace configuration, create listings, calculate fee distributions
or implement purchases. The rollback checks exercise the real Token program;
marketplace settlement rollback must also be verified when purchase logic exists.

The ordinary `pnpm test` command excludes program integration tests. TypeScript
checks include them through the Node-enabled test config; declaration output is
disabled for these non-emitting tests while application declarations remain enabled.
