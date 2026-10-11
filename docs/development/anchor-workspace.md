# Anchor program workspace

The on-chain workspace contains two independent Anchor programs:

| Program     | Source                       | Responsibility                                                     |
| ----------- | ---------------------------- | ------------------------------------------------------------------ |
| Registry    | `programs/katha_registry`    | Artwork identity, attribution, verification, and lifecycle records |
| Marketplace | `programs/katha_marketplace` | Listings, sale eligibility, and settlement                         |

Each program has its own crate, public development ID and reviewed generated IDL.
Registry implements configuration, permanent attribution, verification, metadata
commitments, condition/custody history and atomic Core minting/URI revisions.
Marketplace implements payout bindings, primary/secondary eligibility, temporary
Core delegates, cancellation/expiry recovery and atomic test-token settlement.
Owner-scoped inspections bind current ownership and custody.

The programs are [deployed and initialized on Devnet](devnet-network.md).
That recorded bootstrap does not prove the pending real-artwork demonstration.
Registry also has a feature-gated, local-only Core CPI probe for the
[program test harness](program-testing.md).

## Pinned tools

The workspace pins Anchor CLI 1.2.0, Solana CLI 4.1.2, and Rust 1.95.0.
`Anchor.toml` pins the paired Anchor and Solana versions so AVM does not fall
back to a globally selected Solana version. Rust's `rust-toolchain.toml` selects
the host toolchain used to build the workspace.

From the repository root, verify the active toolchain and build both programs:

```bash
NO_DNA=1 anchor --version
avm solana resolve
rustc --version
NO_DNA=1 anchor build --ignore-keys
```

The expected versions are Anchor 1.2.0, Solana 4.1.2, and Rust 1.95.0. Both
program IDs are configured for localnet and Devnet. Building does not deploy either program
or submit a transaction. Do not commit generated program keypairs or compiled output; build
output lives under the ignored `target/` directory. Public deployment evidence is recorded separately in the network manifest.

The `--ignore-keys` flag skips a local keypair-to-source-ID comparison; it does
not submit or sign a transaction. The build emits an Anchor IDL under
`target/idl/`; reviewed IDLs are eligible for publication. Typed clients are
generated from these IDLs through [Codama](program-clients.md).

To build just one program, pass its crate name:

```bash
NO_DNA=1 anchor build --ignore-keys --program-name katha_registry
NO_DNA=1 anchor build --ignore-keys --program-name katha_marketplace
```

Rust workspace checks run separately from the TypeScript task graph:

```bash
cargo metadata --no-deps --format-version 1
cargo fmt --all -- --check
```

The normal `anchor build` omits the `core-cpi-test` probe. Its Registry IDL
contains the implemented Registry lifecycle instructions; the Marketplace IDL
contains payout, configuration, listing and settlement instructions. Run
`pnpm program:test` for the Core CPI and Registry bootstrap integration gates.
