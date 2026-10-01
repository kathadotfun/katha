# Registry condition attestations

Katha records condition as an ordered series of verifier-signed reports, separate
from artwork authentication, physical custody, and digital ownership. The
Registry stores each report's canonical SHA-256 document hash and bounded public
facts. The detailed report, notes, and inspection media remain outside Solana;
private material must not enter the public repository or account data.

For a verified, still-unminted artwork, the configured verifier first calls
`initialize_condition`. It creates a `ConditionHead` PDA derived from
`["condition", artwork address]` and a version 1 `ConditionAttestation` PDA
derived from `["condition-report", 16-byte report UUID]`. The first reason must
be `INITIAL_VERIFICATION`. The attestation stores the artwork, report UUID,
version, document hash, grade, reason, inspector UUID, verifier wallet,
inspection timestamp, chain-recorded timestamp, and PDA bump. UUIDs use their
16-byte canonical binary form on-chain. The account also reserves optional
owner and custody-revision scope fields; both are `None` before minting.

`record_unminted_condition` accepts a new report UUID and advances the head by
exactly one version when the caller supplies the current version. Pre-mint
follow-up reasons are `PRE_SALE` or `INSURANCE`. Each report account is immutable,
and its globally derived PDA rejects reuse of the same report UUID. The head
points to the current report and hash; earlier reports remain available. A
failed transaction creates no report or history. `ConditionRecorded` emits the
artwork ID, report address/ID, version, hash, grade, reason, inspector, verifier,
times, and empty owner/custody scope.

Both instructions require the registered artwork's canonical PDA, configured
Core collection, and existing authentication attestation. They reject zero
hashes, invalid UUIDs, nonpositive or future inspection times, wrong authority,
invalid reasons, stale/skipped versions, and a bound Core asset. The Registry
does not assert physical possession or a current Core owner from these reports.
A later owner- and custody-scoped path must validate those live facts before
post-mint inspections can affect resale eligibility.

`pnpm program:test` exercises version 1 and 2, account relationships,
authorization, invalid inputs, duplicate IDs/versions, rollback, historical
preservation, and the post-mint boundary using temporary test identities. The
normal Anchor build generates `target/idl/katha_registry.json`. The generated
clients support [unsigned condition transaction builders](attestation-transactions.md)
that validate canonical documents, commitments, verifier roles, and current
account relationships before composing these two pre-mint instructions.

See the [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints)
and [account space reference](https://www.anchor-lang.com/docs/references/space).
