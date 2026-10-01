# Registry artwork identities

`register_artwork` creates a permanent `ArtworkRecord` before authentication or
minting. The caller must sign as the `registration_authority` stored in the
canonical `KathaConfig` account. The record PDA uses the Registry program ID and
`["artwork", katha_id UTF-8 bytes]`. Solana account initialization rejects a
second registration of the same ID. No record update instruction exists for the
identity fields.

The ID is `KATHA-<CATEGORY>-<SERIAL>` with category `MANDALA`, `PAUBHA`, or
`THANGKA` and a nonzero six-digit decimal serial. The enum argument must match
the ID category. The artist ID is a canonical lowercase UUID. The optional
creator wallet is an attribution field, not a payout wallet; an artist can be
registered without one. The record also fixes the creation year (1–9999),
a nonzero 32-byte authorship evidence hash, and the configured Core collection.
Full evidence and private artist documents stay outside the account and Git.

The account allocates 246 bytes, including the Anchor discriminator and maximum
space for both optional public keys. `core_asset` is `None` at registration.
Verification, condition inspection, custody, and the single Core mint/binding
are later instructions; registration itself does not claim authenticity or
ownership. `ArtworkRegistered` emits the identity and attribution fields for
indexing. The public ID and record remain stable through later metadata
revisions and transfers.

The ID shape and immutable fields follow the shared artwork schema. A future
transaction builder must validate the same inputs before offering a transaction;
the program checks them again. `pnpm program:test` executes the registration
success and rejection cases in LiteSVM with synthetic authorities. The generated
Registry IDL in `target/idl/katha_registry.json` is the authoritative account and
instruction interface.

See the [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints),
[account space reference](https://www.anchor-lang.com/docs/references/space),
and [PDA guide](https://www.anchor-lang.com/docs/basics/pda) for the underlying
rules.
