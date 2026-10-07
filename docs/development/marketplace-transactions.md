# Marketplace transaction preparation

The Solana package exports four builders backed by the generated Marketplace
client. They prepare one unsigned Kit instruction and transaction message; they
never fetch accounts, generate keys, sign, send or confirm a transaction.

| Builder                           | Instruction signer            | Required reviewed values                         |
| --------------------------------- | ----------------------------- | ------------------------------------------------ |
| `buildCreateListingTransaction`   | Current Core owner            | Katha ID, price, expiry, current revision        |
| `buildCancelListingTransaction`   | Recorded seller/current owner | Katha ID and active revision                     |
| `buildExpireListingTransaction`   | Any wallet at/after expiry    | Katha ID and active revision                     |
| `buildPurchaseListingTransaction` | Buyer                         | Katha ID, buyer, mint, price and active revision |

## Inputs and output

`MarketplaceTransactionContext` extends the existing
[transaction context](registration-transactions.md) with `chainTime`: a positive
chain Unix timestamp supplied by the caller. `authorityAddress` is the instruction
signer in the table. The fee payer can be a different wallet. Context also binds
Localnet/Devnet, supported wallet transaction versions, recent blockhash, last valid
block height and current block height. An expired blockhash or unsupported version
fails before returning the message. Localnet uses v0; Devnet chooses v1 when the
wallet supports it, otherwise v0.

Each builder receives caller-fetched encoded snapshots for Marketplace and Registry
configuration, the registered artwork, its Core asset and collection, and the
listing PDA. The first listing accepts a missing PDA or a prefunded, otherwise
empty System account with expected revision zero. Later operations require a
validated Marketplace record and exact reviewed revision. Creating/replacing a
listing additionally receives the current condition head. Purchasing receives the
condition head and immutable artist sale terms.

Prices (`price` or `expectedPrice`) are canonical positive integer decimal strings
in six-decimal test-token **base units**, validated by the shared listing schema.
For example, `"100000000"` represents 100 test tokens. No floating-point conversion
occurs. Revisions are bounded `bigint` values; timestamps fit a signed 64-bit
integer. Buyers explicitly review `buyerAddress` and `paymentMintAddress`; a changed
actor, mint, price, revision, owner or condition commitment requires a new quote.

Results include the unsigned `instruction`, `transactionMessage`, `cluster`,
`requiredSignerAddresses`, canonical `addresses` and intended `nextRevision`.
No signer implementations or signatures leave the boundary. The next revision is
a proposed outcome, not proof the operation executed. The caller must simulate,
request wallet approval, submit and reconcile a successful finalized transaction.
The existing API and browser Registry operation/receipt allowlists remain
Registry-specific; Marketplace API and collector signing flows follow later.

## Account checks and payout policy

Configuration checks bind program IDs, canonical PDAs and bumps, allocated sizes,
discriminators, Core collection authority, Registry configuration, treasury,
classic SPL Token, six decimals and fee bounds. Artwork checks preserve the
permanent category/ID, Registry-derived Core asset, collection and current owner.
Listing checks bind artwork/asset/configuration/mint, active owner where applicable,
revision and primary/secondary history. Current condition hashes and versions must
match the offer at purchase. Immutable sale terms must match its artist payout.

Purchase derives existing associated token accounts for buyer, seller, artist and
treasury using the configured classic Token mint. Same-wallet payout roles produce
one destination address. These builders intentionally support canonical ATAs;
they do not accept arbitrary token-account overrides or create/fund accounts.
All four ATAs, including zero-proceeds roles, must exist before purchase. A buyer
whose ATA would also be a payout destination is rejected. Network fees remain
separate from test-token purchase amounts.

Cancellation remains available after expiry. Expiry recovery is inclusive at the
offer's timestamp. Neither requires a fresh condition report: an expired or changed
inspection must not prevent unlocking an otherwise valid listing.

Snapshots are preflight checks, not a substitute for current chain execution.
The program still rechecks verification, inspection age/owner/custody, delegates,
supported plugins, mint state, token-account state and balances atomically. This
client does not calculate a sale approval, modify custody, assert physical delivery,
add token approvals, choose production economics or initiate a wallet transaction.

## Verification

```bash
pnpm --filter @katha/solana typecheck
pnpm --filter @katha/solana test
pnpm program:test
pnpm codegen:check
```

Synthetic unit snapshots cover wrong owners/addresses/types/sizes/programs, forged
bindings, stale buyer/mint/price/revision/condition, self-purchase, invalid amounts
and times, blockhash expiry, version fallback, signer roles, ATA derivation and
shared payouts. The purchase harness executes builder-produced cancellation,
relisting, permissionless expiry recovery and purchase instructions with temporary
signers against real Registry/Marketplace/Core fixtures. Generated clients and IDLs
are unchanged. No external wallet or deployed application is needed.

Kit documents [unsigned message composition and blockhash lifetimes](https://www.solanakit.com/docs/advanced-guides/transactions).
See [purchase settlement](marketplace-purchase.md) and
[settlement failure tests](marketplace-failure-tests.md) for on-chain behavior.
