# Local program test harness

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
Surfpool instance, loads the Registry and verified Core binaries, runs the
integration suites, and stops Surfpool. Both binaries are also loaded into LiteSVM.
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

The Registry initialization suite uses a fresh Core collection whose update
authority is the Registry PDA. It checks the program's upgrade authority, linked
ProgramData, canonical PDAs, collection ownership and authority, role values,
and duplicate initialization. Failed cases leave the config account absent.
LiteSVM's upgradeable ProgramData and Surfpool's program-authority cheatcode
provide synthetic test authorities. The same LiteSVM suite registers a bounded
artwork, rejects invalid identity inputs and duplicate registration, then tests
verifier-only authentication, account/PDA and collection substitution, wrong
evidence hash, and replay rejection. No existing wallet is read.

The probe instruction exists only with the `core-cpi-test` Cargo feature. The
ordinary `NO_DNA=1 anchor build --ignore-keys` omits it; the normal Registry
IDL contains platform initialization, artwork registration, authentication,
and pre-mint metadata commitments.
The test binary lives in a separate ignored directory; do not deploy it.
Condition, custody, and minting instructions come in later steps.

The underlying [Core CPI builder](https://www.metaplex.com/docs/smart-contracts/core/using-core-in-anchor),
[LiteSVM program loading](https://www.anchor-lang.com/docs/testing/litesvm),
and [Surfpool program cheatcodes](https://solana.com/docs/tools/surfpool/rpc/cheatcodes)
are documented by their maintainers.
