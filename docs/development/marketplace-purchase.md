# Atomic artwork purchase

`purchase_listing(expected_revision, expected_price)` lets a buyer sign for an
active offer. The seller authorized the offer and Core delegates during listing;
a fresh seller signature is not required. The program validates the reviewed
revision and exact integer price. Purchase requires chain time strictly before
expiry and rejects buying one's own listing.

## Eligibility and account validation

Purchase validates canonical Marketplace/Registry configuration and artwork PDAs,
verification, immutable artist payout terms, persistent listing history, the
Registry-bound Core asset and collection, and current Core ownership. Primary or
secondary classification comes from completed-sale count and must match the offer.

It reuses live sale eligibility checks, including verification evidence, authorized
current condition report, collector owner/custody scope and inspection age. Listing
condition address/hash/version and custody revision must still match current heads.
A changed inspection or custody revision requires cancellation and relisting;
passing a newer valid report cannot silently replace the reviewed offer.

Both frozen Freeze Delegate and Transfer Delegate authorities must belong to the
listing PDA. Unsupported internal/external asset plugins and nonempty collection
plugin registries are rejected. The collection update authority must match Registry
configuration. Core program identity is fixed and executable.

The payment mint must be the configured classic SPL six-decimal test mint, with no
freeze authority. Token program identity is fixed to classic SPL. Every source and
payout account must have the Token program owner, exact classic account length,
initialized unfrozen state and configured mint. Source ownership must match the
buyer; payout ownership must match recorded seller, artist payout and treasury.
All payout accounts must already exist, including roles with zero proceeds.

The buyer must fund the full gross price. Its source cannot alias any payout
account: classic SPL self-transfers must not bypass payment. Overlapping payout
wallets use the same destination account and are merged with checked addition.
The program deliberately permits duplicate writable payout accounts while validating
their owners and roles; arbitrary account aliasing is not accepted. Token accounts
need not be associated accounts, but all ownership and mint constraints still apply.

## Atomic settlement

Within one transaction, the program:

1. Computes the [checked role distributions](marketplace-distributions.md), validates
   recipients and sends nonzero merged payouts using classic SPL `transfer_checked`.
2. Thaws the asset using the listing PDA and revokes its Freeze Delegate authority.
3. Transfers Core ownership to the buyer using the temporary Transfer Delegate.
   Core resets that one-time authority on transfer; attached owner-managed plugins
   remain unfrozen and controlled by the buyer.
4. Marks the persistent ledger `Purchased`, increments listing revision and
   completed-sale count with checked arithmetic, and emits `ArtworkPurchased`.

The event preserves seller/buyer, artwork/asset/listing, payout wallets, mint, gross
price, separate role amounts, sale kind, new revision and completed-sale count,
condition commitments, custody revision and chain timestamp. The previous offer's
terms remain in the ledger. Repeated or stale purchases fail.

Any error, including a later instruction failure, rolls back payouts, Core changes,
ledger state and successful settlement as a whole. Only successful finalized
transactions should enter the indexer. Authorship, Registry artwork state and
physical custody do not change. Payment never asserts physical delivery.

The buyer pays any Core CPI costs; transaction network fees belong to the transaction
fee payer. No platform signer, server key, payment escrow, mainnet payment or public
purchase API/UI is introduced here. Transaction builders and collector flows follow
in later steps.

## Verification

```bash
pnpm program:build
pnpm codegen:check
cargo test --workspace --locked
pnpm program:test
```

Real Core/Registry/classic SPL tests cover primary and secondary settlement, delegate
reset, preserved attribution/custody, duplicate purchases, signer/account/mint/program
substitution, exact price/revision binding, revoked authority, insufficient/frozen
funds, stale condition/custody, collector inspection expiry and complete transaction
rollback. All fixtures and signing identities are temporary and synthetic.

Core delegate behavior follows the official [Transfer Delegate](https://www.metaplex.com/docs/smart-contracts/core/plugins/transfer-delegate)
and [Freeze Delegate](https://www.metaplex.com/docs/smart-contracts/core/plugins/freeze-delegate)
interfaces; token transfers use the classic [SPL Token program](https://www.solana-program.com/docs/token).
