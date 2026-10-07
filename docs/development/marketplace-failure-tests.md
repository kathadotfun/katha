# Marketplace settlement failure tests

Run `pnpm program:test` from the repository root. The purchase suite in
`packages/solana/tests/marketplace-purchase.test.ts` executes compiled Marketplace
and Registry programs against Core and classic SPL Token in isolated LiteSVM.
Signing identities and artwork/payment fixtures are temporary and synthetic.
No real purchase or wallet approval is required.

## Competing transactions

Two buyers prepare instructions against the same active listing revision before
either transaction executes. Both possible winner orders are tested. Exactly one
purchase settles; the other buyer retains its funds, and the listing records one
completed sale with the first buyer as Core owner.

Purchase/cancellation is tested in both execution orders. The first successful
transaction determines the outcome. The second cannot change balances, ownership
or the terminal listing. Cancellation followed by relisting increments the
revision; an old purchase quote cannot buy the replacement offer, even at the
same price. The current quote can still settle.

These are deterministic serialized conflict tests, matching the two possible
orders for transactions sharing writable accounts. They do not measure validator
scheduling, RPC latency or parallel throughput.

## Exact distributions and overlapping roles

Primary settlement runs at integer base-unit prices 1, 39, 40, 101 and `u64::MAX`.
The maximum-price fixture sets the total mint supply and buyer balance to the
maximum, with all other holders empty. Gross deductions use widened arithmetic
and independently floored fees. A secondary 101-unit purchase pays 94 to the
seller, 5 to the artist and 2 to treasury. No floating-point amounts are used.
Zero/full commission cases also validate destinations whose proceeds are zero.

Secondary settlement tests each pair of overlapping seller, artist and treasury
wallets, plus all three roles sharing one wallet. Each role's proceeds remain
accounted for while payments merge into one token account per recipient. Two
otherwise valid token accounts for the same payout wallet are rejected; selecting
the shared account recovers without a duplicate payment.

## Failure after payments begin

The existing tests reject insufficient/frozen funds, changed condition/custody,
expired inspections/offers, wrong authorities/accounts/programs/mints, and repeated
purchases. A successful purchase followed by a failing instruction also restores
the transaction's original settlement state.

Two additional tests simulate a successful purchase to obtain CPI consumption
logs, then choose a compute limit inside a later call:

- Token failure occurs after one payout CPI succeeds, during the second payout.
- Core failure occurs after both payouts, thaw and Freeze Delegate self-revocation
  succeed, during the ownership transfer CPI.

The failed transaction is actually submitted to LiteSVM. Logs must prove the
expected prior successes and failing program. Tests compare the complete Core
asset and listing accounts and all payment balances against their snapshots,
including the original frozen state and delegate authorities. A fresh normal
purchase then succeeds exactly once with the expected distribution.

Compute limits derive from logs instead of a compiler-dependent fixed threshold.
The calculation accounts for the runtime's 200,000-unit default for one purchase
instruction and 150 units consumed by the added Compute Budget instruction.
It fails explicitly if expected logs or execution stages change.

Network transaction fees are outside the rollback assertions: a failed transaction
can still charge its fee payer. Successful simulation logs alone are never proof
of a committed sale. Production indexing must require successful finalized
transactions, as described in [purchase settlement](marketplace-purchase.md).

Synthetic account mutations exercise boundaries and alternate payout accounts;
they do not issue real tokens. Destination-overflow states with total balances
above `u64::MAX` are not treated as valid token supplies. Runtime CPI failures
provide the rollback evidence without relying on such impossible issuance.
