# Core CPI program test harness

Run from the repository root after the pinned Anchor 1.2.0, Solana CLI 4.1.2,
Rust 1.95.0, pnpm, and Surfpool 1.6.0 tools are installed:

```bash
pnpm program:test
```

The command verifies a pinned SHA-256 of the public Devnet Metaplex Core program
binary, downloading it with the read-only `solana program dump` command on the
first run. It caches the binary under ignored `target/test-fixtures/`. If Core is
upgraded and the hash changes, the test stops so the new program version can be
reviewed and pinned deliberately. No Core binary enters Git.

The command builds Registry with `core-cpi-test` into ignored
`target/core-cpi-test/`, typechecks the harness, starts an isolated offline
Surfpool instance, loads that Registry probe and the verified Core binary, runs
the test, and stops Surfpool. The test also loads both binaries into LiteSVM.
The local fixtures generate temporary in-memory signers and use synthetic
collection metadata. No existing wallet is read, no network transaction is
sent, and no program is deployed to Devnet.

Both runners execute the standard `mpl-core` 0.12.1
`CreateCollectionV2CpiBuilder` through the Anchor 1.2.0 Registry probe. They
assert a Core-owned CollectionV1 account appears after a successful CPI, and
that duplicate creation, a missing collection signature, and a substituted
Core program fail without creating a new collection. The Registry probe uses
Core's standard Rust CPI interface; Core's optional older Anchor integration
features are not enabled.

The probe instruction exists only with the `core-cpi-test` Cargo feature. The
ordinary `NO_DNA=1 anchor build --ignore-keys` omits it and keeps the normal
Registry IDL empty. The test binary lives in a separate ignored directory; do
not deploy it. Actual artwork Registry instructions, state, and lifecycle
rules start in later steps.

The underlying [Core CPI builder](https://www.metaplex.com/docs/smart-contracts/core/using-core-in-anchor),
[LiteSVM program loading](https://www.anchor-lang.com/docs/testing/litesvm),
and [Surfpool program cheatcodes](https://solana.com/docs/tools/surfpool/rpc/cheatcodes)
are documented by their maintainers.
