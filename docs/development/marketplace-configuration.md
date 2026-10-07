# Marketplace configuration

`initialize_marketplace` creates the single `marketplace-config` PDA. Both the
Marketplace upgrade authority and the current Registry configuration authority
must sign. They may be different wallets; the upgrade authority funds account
creation. The instruction verifies the Marketplace executable and its linked
upgradeable-loader ProgramData before accepting the bootstrap signer.

The Registry executable has the pinned Registry program ID. Its configuration
must have the correct owner, discriminator and canonical `katha-config` PDA.
Marketplace copies the Registry authority, collection and non-default treasury,
so a caller cannot substitute a payout recipient. These checks use
[Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints).

The authorized signers select an initialized classic SPL payment mint with exactly
six decimals and no freeze authority. The classic Token program ID is required;
Token-2022 mints and arbitrary token accounts are rejected. Selection records the
mint once; no public Devnet mint address is selected by this local fixture setup.

Commission and secondary royalty use integer basis points. Their combined value
must be at most 10,000, using widened arithmetic before comparison. Inspection
validity must be positive and fit a signed 64-bit timestamp. Local simulation
settings are 250 commission basis points, 500 secondary royalty basis points and
2,592,000 seconds (30 days). These are development defaults. Configuration stores
its version, bump, network accounts, mint decimals and settings, and emits
`MarketplaceInitialized`. No update or close instruction exists at this stage;
duplicate initialization fails without replacing the existing configuration.

## Compatible build and verification

The Rust token dependency is exactly `anchor-spl = 1.2.0`, matching the pinned
Anchor CLI and `anchor-lang` crate. Runtime features enable only classic `token`.
Anchor SPL 1.2.0 IDL generation references its token interface module, so the
`idl-build` feature additionally enables `anchor-spl/token_2022`. This is an
IDL-generation compatibility requirement; runtime account types remain
`Account<Mint>` and `Program<Token>` with classic SPL owner and program checks.
The Registry crate is used through its CPI feature for typed configuration access.

```bash
pnpm program:build
pnpm codegen
pnpm codegen:check
cargo test --workspace --locked
pnpm program:test
```

The existing harness builds a separate Marketplace SBF binary and loads it into
LiteSVM alongside real Registry/Core/token fixtures. Tests verify stored fields,
distinct required signers, missing signatures, takeover and duplicate attempts,
forged ProgramData/Registry accounts, wrong owners/programs, default treasury,
wrong decimals, uninitialized/frozen mints, Token-2022 rejection and settings
bounds. Rejected initialization leaves the configuration absent; failed duplicate
attempts preserve its exact bytes. A fresh blockhash prevents failed-transaction
replay caching from hiding the validation being tested.

Listings and settlement are subsequent program work. Initialization does not
change artwork ownership, authorship or physical custody.
