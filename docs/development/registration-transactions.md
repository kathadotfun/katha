# Registry registration transactions

`@katha/solana` exports `buildInitializePlatformTransaction` and
`buildRegisterArtworkTransaction`. Both return an unsigned Kit transaction
message, its generated instruction, canonical account addresses, cluster, and
deduplicated required signer addresses. No wallet keys or signing functions are
included in the result.

## Inputs and account snapshots

Pass a `RegistryTransactionContext` with the localnet or Devnet cluster, fee payer
address, authority address, wallet-supported transaction versions, recent
blockhash lifetime, and current block height. Fetch the lifetime and accounts
from the same configured cluster. The builders reject malformed or expired
lifetimes; preparation cannot guarantee that a blockhash stays valid until signing.
Localnet uses version 0. Devnet prefers version 1 when supported, otherwise 0.

Bootstrap requires the deployed Registry executable, its canonical upgradeable
loader ProgramData account, and the Core collection account. Supply existing
account snapshots including `exists: true`, such as results from
`fetchOwnedEncodedAccount`. The builder verifies the loader owner, program-data
pointer, upgrade-authority signer, Core owner, and collection authority PDA.
Provide nonzero registration, verifier, custody, and treasury addresses.
The program additionally enforces a fresh, plugin-free collection and singleton
initialization; preparation alone does not establish these conditions.

Registration requires the canonical Registry configuration snapshot. It checks
ownership, discriminator, exact account size, PDA bumps, collection-authority
relationship, and the configured registration signer. The input uses shared
domain fields: permanent `kathaId`, category, canonical lowercase UUID `artistId`,
optional `creatorWallet`, integer `creationYear`, and nonzero lowercase SHA-256
`authorshipEvidenceHash`. The category must match the permanent ID. The creator
wallet is attribution, not a required signer or a replacement for artist identity.

## Preparing registration

```ts
import { buildRegisterArtworkTransaction } from "@katha/solana";

const prepared = await buildRegisterArtworkTransaction(context, configAccount, {
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA",
  artistId: "123e4567-e89b-42d3-a456-426614174000",
  creatorWallet: null,
  creationYear: 2025,
  authorshipEvidenceHash: evidenceHash,
});
```

Here `context`, `configAccount`, and `evidenceHash` are caller-provided validated
inputs. The fee payer and registration authority must approve the transaction;
one signature suffices when those addresses coincide. The generated instruction
retains signer and writability roles while carrying no signer implementation.
Neither builder fetches accounts, simulates, signs, submits, mints, or changes
physical custody. Later operation and wallet workflows add resource estimation,
simulation, authorization, signing, confirmation, and receipt reconciliation.
On-chain checks remain authoritative if account state changes after preparation.

## Verification

```bash
pnpm build
pnpm --filter @katha/solana typecheck
pnpm --filter @katha/solana test
pnpm program:test
pnpm codegen:check
```

Unit tests cover generated encoding, canonical PDAs, explicit signer roles,
unsigned compilation, version selection, and malformed or substituted inputs.
The local Registry harness prepares initialization and registration with these
builders, signs using temporary test identities, executes them in LiteSVM, and
decodes the resulting accounts. Existing program failure tests continue to
verify authorization and rollback. No Devnet wallet approval is performed.

Kit documents [transaction composition](https://www.solanakit.com/docs/advanced-guides/transactions)
and [blockhash lifetimes](https://www.solanakit.com/api/functions/setTransactionMessageLifetimeUsingBlockhash).
