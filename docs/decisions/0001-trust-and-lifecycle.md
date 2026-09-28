# ADR 0001: Trust and artwork lifecycle boundaries

Status: accepted for implementation.

Scope: the local/Devnet MVP defined in the [product specification](../product/mvp.md).
The [architecture overview](../architecture/overview.md) and
[artwork lifecycle](../architecture/artwork-lifecycle.md) apply this decision.

## Context

A painting can change digital owner while remaining with its current custodian.
Artist attribution must survive those changes. Private evidence and delivery data
cannot be placed in public chain records, and the API/database can temporarily lag
successful transactions. These constraints require explicit authority boundaries
and independent state dimensions.

## Decisions

1. **Keep Core ownership and Registry attestations distinct.** Core holds the
   current owner; Registry holds immutable identity, artwork binding, signed
   verification/custody/condition facts, and metadata commitments. PostgreSQL
   provides application records and projections, with chain-derived state clearly
   identified as a read model.
2. **Register before minting and bind once.** A permanent artwork identity precedes
   asset creation. Registry-controlled deterministic derivation and atomic Core CPI
   prevent successful partial mint/bind operations. Exact seed encodings and account
   layouts are defined with code and verified by the program harness.
3. **Use separate lifecycle state.** Verification, physical custody, publication,
   condition, listing, resale approval, and digital ownership have separate owners
   and transition rules. Eligibility is derived from current authoritative facts.
   A physical custody record identifies the custodian even when the custodian and
   current digital owner differ.
4. **Version exact public document bytes.** Canonical metadata and condition reports
   preserve historical bytes and hashes. Registry-controlled Core update authority
   makes post-mint URI/commitment changes atomic. Immutable artist attribution is
   never rewritten by a metadata revision.
5. **Use wallet-held signing.** The API authenticates sessions, checks roles,
   prepares and simulates unsigned transactions, and validates expected receipts.
   The authorized wallet reviews and signs. Programs independently enforce all
   trust-critical account and authority relationships.
6. **Use temporary listing delegates.** The seller retains Core ownership while
   listed. Marketplace-controlled delegates enable atomic unlocking, payment, and
   transfer; cancellation/expiry recovery releases authority. Permanent transfer
   or freeze delegates and a general platform transfer wallet are not required.
7. **Recheck inspection eligibility at execution.** Collector-held resale binds
   an anchored inspection to the current owner and custody facts, with configurable
   validity. Marketplace enforcement cannot depend solely on an API status flag.
   Physical inspection and fulfillment remain manual.
8. **Index successful finalized activity.** Events, projections, and checkpoints
   persist atomically and replay idempotently. Core transfers and Marketplace
   settlements are correlated, gaps are visible, and live ownership reconciliation
   recovers stale projections without fabricating sale history.

## Alternatives considered

| Alternative | Reason for the chosen design |
|---|---|
| One combined artwork status | Cannot accurately represent custody, sale, and inspection independently |
| Database as the current-owner authority | Can lag, be edited, or miss chain activity |
| One unbounded on-chain owner-history array | Grows with every transfer and makes history an account-size problem |
| Separate Core mint and Registry bind transactions | Allows a successful partial result or mismatched binding |
| Direct URI updates followed by a later hash update | Exposes a period where metadata and commitment disagree |
| Permanent listing delegates | Retain transfer/freeze power beyond a specific listing |
| API-controlled signing and sale approval | Makes backend trust replace wallet and program enforcement |
| A new database or queue for indexing | Adds infrastructure before the polling worker requires it |

## Consequences and verification

The design preserves independently verifiable ownership and commitments, but
physical verification remains an operator claim. Storage availability, RPC
history availability, and indexer freshness must be reported honestly.

A Registry-controlled collection authority still depends on the Registry program
and its Devnet upgrade authority. Program deployment/upgrade authority and role
configuration are reviewed during bootstrap; a PDA alone is not an immutability
guarantee. Production authority governance is outside this MVP.

The implementation must demonstrate unauthorized initialization rejection, stable
PDA derivation, duplicate mint prevention, Core URI/commitment rollback, delegate
locking and cleanup, stale-owner/custody inspection rejection, exact payment
settlement, failed-operation exclusion, and replay/backfill without duplicates.
These are future implementation gates, not checks completed by this ADR.

The agreed toolchain stays Anchor 1.2.0 / Solana CLI 4.1.2 with standard Core Rust
CPI. Kit types remain in application boundaries, and Umi types stay in the adapter.
IDLs and generated Codama clients are produced together with program changes.

The owned public domain is `katha.fun` and the official X handle is
`@kathadotfun`. Local/LAN demo services use their configured origin. Domain
ownership does not add hosted deployment, mainnet, production payment economics,
or automated physical settlement to this decision.
