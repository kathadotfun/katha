# Inspected local resale

The resale integration begins with a genuine primary purchase, then exercises
Registry custody/inspection instructions and builder-produced Marketplace
transactions against the pinned programs and real Core/SPL Token execution in
LiteSVM. Follow [program setup](program-testing.md), then run:

```bash
pnpm program:test
```

`packages/solana/tests/marketplace-resale.test.ts` contains four lifecycle cases.
All identities, documents, balances and timestamps are synthetic. No wallet file,
external transaction, physical handover or Devnet deployment is used.

## Continuous Katha custody

Wallet A purchases the artwork from its original owner, then lists it for Wallet B.
The initial condition attestation remains eligible while physical custody stays
continuously Katha-held at revision one, including after the collector inspection
age limit. The original owner cannot list Wallet A's Core asset. Listing locks the
asset while A retains ownership; buying transfers ownership to B without changing
physical custody, inspection history or permanent artist attribution.

## Collector-held inspection

After the primary purchase, the authorized custodian records dispatch and receipt
by A. In-transit artwork cannot be listed. The initial inspection and a `PreSale`
report do not authorize a collector-held secondary sale. A verifier must record a
`PreResale` inspection scoped to the current Core owner and custody revision.
Wrong verifier, owner or custody revision fails without creating an attestation.

The test lists with a valid approval, advances the clock beyond the configured
30-day validity while the offer remains unexpired, and confirms purchase fails
without partial payment or transfer. The seller can cancel this offer. Its expired
approval cannot authorize relisting; a new immutable report restores eligibility.
Purchase at exactly the new report's validity boundary succeeds.

Core then belongs to B while physical custody still names A. B cannot reuse A's
inspection. Authorized dispatch/receipt changes the physical holder to B, and a
fresh B-scoped inspection is required before B can list. Creating/cancelling that
offer preserves the two completed sales. Digital ownership, physical custody and
inspection approval therefore remain separate throughout the journey.

## Changes during an active offer

Two additional cases prepare a purchase, then either revise the condition report
or dispatch the artwork from collector custody. Both the previously prepared
instruction and the current client purchase attempt fail. Core remains locked
with A as owner; balances and sale count are unchanged. Cancellation still works.
After a condition revision, a fresh listing binds the new report. After physical
return to Katha, a `ReturnToCustody` inspection must bind the new custody revision;
the older collector approval cannot authorize the returned artwork's resale.

## Settlement and preserved history

For a 100-token primary price followed by a 100-token resale, the development
settings are 250 basis points commission and 500 basis points secondary royalty:

| Sale      | Seller proceeds | Artist proceeds | Treasury fee |
| --------- | --------------- | --------------- | ------------ |
| Primary   | 0               | 97.5            | 2.5          |
| Secondary | 92.5            | 5               | 2.5          |

The tests read actual token balances and Core ownership/delegates, check the
persistent ledger's revisions and completed-sale count, and decode the ordered
primary and secondary purchase events. Earlier identity, verification, metadata,
condition and custody-transition accounts remain byte-for-byte intact. Failed
transactions do not add a sale. The account comparisons exclude the network fee
payer because failed transactions can still charge native fees.

Completed listings retain the kind of the sale just settled. The unsigned builder
validates that kind against the count before that completed sale, rather than
mistaking a completed primary sale for a secondary offer. A regression test also
rejects impossible purchased histories, including zero completed sales.

These checks cover local program/client behavior. Physical inspections remain
manual attestations; Marketplace API/indexing/browser integration and the manual
Devnet demonstration follow separately. See [primary sale](marketplace-primary-sale.md),
[unsigned builders](marketplace-transactions.md) and
[purchase settlement](marketplace-purchase.md).
