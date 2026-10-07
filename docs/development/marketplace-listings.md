# Fixed-price listing creation

`create_listing(price, expires_at, expected_revision)` activates one canonical
`["listing", asset]` ledger. The actual Core owner signs as seller and funds ledger
rent plus Core plugin storage. Prices are exact `u64` token units, positive, with
expiry strictly later than current chain time. The configured six-decimal test
mint and immutable artist payout come from validated Marketplace accounts.

Creation calls the same live verification, Core identity/owner, payout, condition
and custody policy as the [eligibility preview](marketplace-eligibility.md).
It binds the current condition report address, hash and version, custody revision,
seller, price and expiry into the record. `ListingCreated` emits those public
commitments and the primary/secondary kind. No private inspection content is included.

## Core lock and authority

The program uses Core's standard Rust CPI interface with existing exact pins. It
first adds a [Transfer Delegate](https://www.metaplex.com/docs/smart-contracts/core/plugins/transfer-delegate),
then a frozen [Freeze Delegate](https://www.metaplex.com/docs/smart-contracts/core/plugins/freeze-delegate).
Both have the listing PDA as explicit address authority. Core retains the seller
as owner. The owner cannot transfer the frozen asset or thaw it using the owner's
signature. No custody transition occurs and immutable artist attribution stays intact.
The program currently exposes no instruction using its delegate signatures.

Only assets and the Registry-bound collection with empty internal and external
plugin registries can enter this path. This narrow MVP boundary prevents an existing
delegate, permanent authority or external hook from bypassing/conflicting with the
lock. It accepts an empty plugin registry left after plugin removal, but does not
silently replace existing plugins. The collection's update authority must match
the Registry's configured collection-authority PDA. Core requires the collection
writable for plugin administration; Marketplace validates its identity before CPI.

## Persistent history and atomicity

A first listing requires expected revision zero and stores revision one. Existing
inactive, cancelled, expired or purchased records require the exact stored revision
and increment it with checked arithmetic. The completed-sale count persists; a
positive count classifies a new offer as secondary even if the asset returned to
its original owner. Creation does not increment the completed-sale count.

An active record is rejected, including one whose expiry has passed. Expiry does
not itself execute an unlock. Explicit cancellation/expiry recovery is subsequent
program work; creation cannot replace an active offer.

For a new ledger the handler verifies System ownership and empty data, tops up
rent, allocates its bounded space and assigns Marketplace ownership using the
canonical PDA signature. Prefunding an empty PDA cannot deny valid creation. An
existing program-owned ledger must deserialize at the exact expected size and
match its version, accounts, payout, mint and bump; it is never reinitialized.

Ledger allocation, both Core plugin additions, record serialization and event
emission commit together. Any error rolls back the entire transaction, including
Core reallocations and rent movements. Payment settlement and ownership transfer
are later instructions, with eligibility rechecked at purchase.

## Local verification

```bash
pnpm program:build
pnpm codegen
pnpm codegen:check
cargo test --workspace --locked
pnpm program:test
```

Tests execute real Core CPIs, inspect both delegate authorities and frozen state,
and prove ordinary transfers work on an unfrozen fixture but fail on a listed one.
They cover owner/signature/account substitution, invalid terms, stale revisions,
active/expired-active duplicates, conflicting plugins, verification and transit,
prefunded PDA allocation and transaction rollback after a successful create followed
by an insufficient-funds transfer. Synthetic inactive sale-history bytes exercise
reopening without pretending a prior purchase occurred. Every identity is temporary
and every token/artwork fixture is synthetic. No dependencies or toolchain versions
change in this step.
