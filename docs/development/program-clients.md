# Generated Solana program clients

The reviewed Anchor IDLs in `target/idl/` are the inputs to the Kit-compatible
clients in `packages/solana/src/generated/{registry,marketplace}`. Do not edit
generated TypeScript or IDLs by hand. Change Rust source, rebuild the normal
programs, and regenerate both clients.

The root development dependencies pin `codama` 1.11.0,
`@codama/nodes-from-anchor` 1.5.6, and `@codama/renderers-js` 2.5.0. The converter
reads Anchor's IDLs, and the renderer emits Kit 8-compatible TypeScript with
explicit `.js` imports for Node ESM. The generator uses the pinned workspace
Prettier and its configuration for reproducible formatting. It does not install
packages or rewrite package manifests. See the official
[Anchor conversion workflow](https://github.com/codama-idl/codama#coming-from-anchor)
and [Kit renderer options](https://github.com/codama-idl/renderers-js#options).

## Regenerate and verify

From the repository root:

```bash
pnpm program:build
pnpm codegen
pnpm codegen:check
pnpm --filter @katha/solana typecheck
pnpm --filter @katha/solana test
pnpm program:test
```

`program:build` uses the pinned Anchor toolchain without the local-only Core CPI
probe. It rebuilds both programs and IDLs; it does not deploy them. `codegen`
reads those IDLs and replaces only the two generated client directories, removing
obsolete files. Keep changed reviewed IDLs and generated clients with each
program change. Local keypairs, binaries, test fixtures, and build output remain
excluded.

`codegen:check` renders both clients in a temporary directory and compares the
complete filename sets and exact bytes to the checked-in output. Missing, changed,
and obsolete files fail with their paths. It never repairs or overwrites source
files. Run `codegen` twice and require identical output when changing generation
settings or dependency pins. CI runs `codegen:check` against the reviewed IDLs;
it does not build SBF or prove that the IDLs match Rust. Rebuild and review IDLs
locally when Rust changes.

## Imports and trust boundaries

After building `@katha/solana`, consumers use separate subpaths:

```ts
import {
  getRegisterArtworkInstructionAsync,
  getArtworkRecordDecoder,
} from "@katha/solana/registry";
import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "@katha/solana/marketplace";
```

The Registry includes typed instruction builders/parsers, account codecs, event
codecs/parsers, error definitions, and PDA helpers. The Marketplace currently
has no instructions or accounts; its client exposes its public development
program address. No generated helper submits a transaction. Transaction
composition, simulation, authorization, and wallet approval are separate steps.

Generated account decoders deserialize bytes; they do not establish account
ownership, validate every discriminator, or enforce domain rules. First validate
the expected program owner, discriminator, PDA, collection, and account
relationships. Generated instruction parsers likewise assume the caller selected
the correct program and instruction discriminator. Event parsers check their
event discriminator; the indexer must still verify the source program and
successful finalized transaction.

Codama distinguishes repeated PDA account names with different seeds by adding
instruction prefixes, for example `findInitializeMetadataHeadPda` and
`findReviseMintedMetadataRevisionPda`. These converter notices are expected.
Account-data-dependent PDA inputs cannot always be derived from an address
alone; fetch and validate current accounts before providing them. Generated
types describe program layouts; shared Zod schemas remain the HTTP/domain
boundary, including integer decimal-string payment amounts.

Synthetic unit tests verify discriminators, signer/writability roles, PDA seeds,
integer/string encoding, account layouts, and event rejection. The local
Registry harness compares generated registration encoding to its existing
fixture, executes it against LiteSVM, and decodes the actual account.
