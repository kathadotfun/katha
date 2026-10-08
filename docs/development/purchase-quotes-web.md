# Purchase quote display

Open a canonical artwork page and choose **Review purchase quote**. The route is
`/art/{kathaId}/purchase`; valid permanent IDs are required and search indexing is
disabled. Connect and sign in through `/account`, then select **Refresh purchase
quote**. Loading never prompts the wallet to sign or prepares a purchase operation.

The existing [buyer purchase API](artwork-purchases-api.md) receives only supported
transaction versions. Buyer identity comes from the authenticated session; bearer
credentials remain in memory and do not enter server HTML or public artwork reads.
The API reads finalized accounts and simulates purchase eligibility, including
buyer test-token funding. Missing funds, inactive/expired listings, self-purchase,
wrong network and service outages can prevent a quote.

## Exact amounts and terms

The preview shows:

- primary or secondary sale and exact total in six-decimal test tokens/base units;
- separate seller proceeds, artist proceeds and treasury commission with wallets;
- merged recipient-wallet totals when roles share a wallet;
- configured fee rates in basis points and integer rounding behavior;
- expected listing revision, listing expiry, finalized slot and test-token mint;
- quote custody revision and independent recorded physical custody;
- buyer address and canonical quote commitment.

Amount formatting uses BigInt quotient/remainder, preserving all six decimal
places and u64 precision. It never converts token amounts through floating point.
Role distributions are checked against the existing Marketplace calculation, not
hardcoded percentages. Primary seller proceeds are zero; remaining primary units
go to the artist after commission. Secondary deductions floor independently and
remaining units go to the seller. Recipient merging does not erase role amounts.

The client validates shared response/artwork schemas, connected buyer/cluster,
permanent identity and deterministic Core/listing addresses. It verifies the
canonical semantic quote hash and rejects inconsistent distribution or an already
expired chain-time observation. The hash commits to terms, including condition
and custody revisions; it is not an independent signature or proof of authenticity.

Quotes are snapshots, not reservations, payment receipts or guaranteed eligibility.
They can become stale immediately after being read. Recorded custody is a separate
public observation and can lag the quote's custody revision. The page makes no
physical movement claim. Test tokens have no monetary value; SOL network fees are
additional and are not included in the distribution. Purchase signing and finalized
ownership confirmation use the [buyer purchase flow](purchase-web.md).

Refresh clears previous terms before requesting replacements. Failed or malformed
responses hide the old quote and show a redacted retry message. Wallet/session
changes, revocation, disconnect and component disposal abort pending work and discard
late results. A concurrent refresh does not duplicate requests. API error bodies
and wallet errors never appear in the UI.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:collection
pnpm format:check
pnpm codegen:check
```

Unit tests exercise primary/secondary rounding at the u64 limit, recipient overlap,
exact six-decimal formatting, buyer/cluster/asset/listing/hash/distribution/expiry
mismatches, private transport, failure cleanup, concurrent reads and revoked identity.
The real artwork view test checks the purchase quote link. The shared collector
browser suite checks primary and secondary role amounts, merged recipients,
expected revision/custody, retry, redacted failures, no quote-triggered signing,
accessibility and overflow at 375, 768 and 1280px. API/wallet fixtures are synthetic;
live chain execution and real wallet approval remain manual.
