# Sale distribution arithmetic

The Marketplace Rust module `distribution.rs` provides pure checked arithmetic
for purchase settlement. It does not transfer tokens, change ownership, authorize
purchases or expose a new instruction. The [purchase instruction](marketplace-purchase.md) calls it with the validated
listing price, sale kind and Marketplace configuration; arbitrary client fee or
recipient values must never replace those trusted records.

## Amounts and rounding

All amounts are integer token units (`u64`). A basis-point deduction is
`floor(price * bps / 10000)`. Multiplication uses a widened `u128` intermediate and
[checked Rust arithmetic](https://doc.rust-lang.org/std/primitive.u128.html#method.checked_mul),
followed by checked conversion and subtraction. Valid prices up to `u64::MAX` are
supported. Zero prices, fees above 10000 bps or combined commission and secondary
royalty above 10000 bps fail. The same fee validator runs during configuration and
calculation, including primary sales that do not charge secondary royalty.

| Sale kind | Treasury                          | Artist                         | Seller                               |
| --------- | --------------------------------- | ------------------------------ | ------------------------------------ |
| Primary   | Floored commission on gross price | Price minus commission         | Zero                                 |
| Secondary | Floored commission on gross price | Floored royalty on gross price | Price minus commission minus royalty |

Each deduction rounds down independently. Every remaining unit goes to the artist
on a primary sale or seller on a secondary sale. The role amounts sum exactly to
price; no token unit is lost to rounding. There is no minimum commission/royalty:
on a one-unit sale at the development defaults, both deductions are zero.

For 100,000,000 test-token units (100 tokens at six decimals), the simulation defaults
of 250 bps commission and 500 bps secondary royalty produce:

| Sale kind | Treasury units | Artist units | Seller units |
| --------- | -------------: | -----------: | -----------: |
| Primary   |      2,500,000 |   97,500,000 |            0 |
| Secondary |      2,500,000 |    5,000,000 |   92,500,000 |

These rates remain Devnet simulation settings, not production economics.

## Overlapping recipients

`recipient_payments` accepts the validated seller, immutable artist payout and
configured treasury wallets. All three must be non-default addresses, even when
one role receives zero units. Zero amounts are omitted. Matching wallets are
combined using checked addition, so each distinct recipient appears once; role
amounts remain available separately for sale events. Order follows the first
nonzero seller, artist, treasury occurrence.

This combines payout amounts only. Token-account ownership/mint validation, buyer
signatures, balances, self-purchase rules and aliasing with the buyer's source
account belong to the atomic purchase instruction. The [purchase instruction](marketplace-purchase.md) implements these transaction
boundaries.

## Verification

```bash
cargo test --workspace --locked
pnpm program:build
pnpm codegen:check
```

Rust tests cover default splits, one-unit and awkward-price rounding, zero/full
fees, `u64::MAX`, invalid fee bounds/prices, conservation across every commission
boundary and selected prices, all seller/artist/treasury overlap patterns, invalid
recipient addresses and checked merge overflow. No new dependency is required.
