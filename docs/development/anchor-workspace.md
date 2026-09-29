# Anchor program workspace

The on-chain workspace contains Katha's Registry program under
`programs/katha_registry`. It currently has no instructions or account state;
Registry behavior is added in later implementation steps. The generated sample
counter and its test harness are intentionally absent.

## Pinned tools

The workspace pins Anchor CLI 1.2.0, Solana CLI 4.1.2, and Rust 1.95.0.
`Anchor.toml` pins the paired Anchor and Solana versions so AVM does not fall
back to a globally selected Solana version. Rust's `rust-toolchain.toml` selects
the host toolchain used to build the workspace.

From the repository root, verify the active toolchain and build the empty program:

```bash
NO_DNA=1 anchor --version
avm solana resolve
rustc --version
NO_DNA=1 anchor build --ignore-keys
```

The expected versions are Anchor 1.2.0, Solana 4.1.2, and Rust 1.95.0. The
program is configured for localnet. Building does not deploy it or submit a
transaction. Do not commit generated program keypairs or compiled output; build
output lives under the ignored `target/` directory. The public program address
in the workspace is a development identifier, not a deployment claim.

The `--ignore-keys` flag skips a local keypair-to-source-ID comparison; it does
not submit or sign a transaction. The build emits an Anchor IDL under
`target/idl/`; reviewed IDLs are eligible for publication. Typed clients are
generated from IDLs in a later step.
