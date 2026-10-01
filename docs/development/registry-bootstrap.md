# Registry platform bootstrap

The Registry's first production instruction is `initialize_platform`. It creates
one `KathaConfig` account at the canonical PDA seeded by `katha-config` under
the Registry program ID. A second initialization fails because the account already
exists. This is an on-chain contract and local test; no Katha program has been
deployed by this step.

Only the current upgrade authority of the deployed Registry program may initialize
it. The instruction requires that signer, the executable Registry program account,
and its linked upgradeable-loader ProgramData account. The program checks both the
ProgramData link and its upgrade-authority field. A fee payer or arbitrary signer
cannot choose the first platform authority. This requires an upgradeable Registry
deployment during Devnet bootstrap.

Before initialization, create a fresh Metaplex Core collection with its update
authority set to the Registry PDA seeded by `collection-authority`. The instruction
checks that the supplied account is a Core CollectionV1, has zero minted assets,
has no plugins, and names that exact PDA as update authority. The collection PDA
does not need a funded account; it is an address the Registry can sign for in later
Core CPIs. Collection creation and Devnet bootstrap are later operator actions,
not performed by this repository step.

The config stores the bootstrap signer as platform authority, plus the supplied
registration, verifier, custody, and treasury addresses, Core collection address,
collection authority PDA, and both canonical bumps. Role addresses cannot be the
default zero address. The `PlatformInitialized` event records these public keys.
This step supplies no role rotation instruction; changing bootstrap configuration
would require a separately reviewed program change. No private key belongs in
source, tests, logs, or public documentation.

The generated `target/idl/katha_registry.json` describes the instruction and
account layout. `pnpm program:test` verifies successful initialization and
rejections in LiteSVM and Surfpool with synthetic signers. See the
[program test guide](program-testing.md) for reproduction.

The [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints),
[Solana program authority model](https://solana.com/docs/programs/deploying),
and [PDA derivation rules](https://solana.com/docs/core/pda) describe the
underlying checks.
