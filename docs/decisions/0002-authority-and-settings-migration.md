# ADR 0002: Authority recovery and settings migration

Status: migration design; implementation and Devnet deployment pending.

The user selected a **2-of-3 governance multisig with separate operational
wallets**, and confirmed that artists can approve wallet messages. This document
defines the migration contract for that selection. It does not change the running
programs, API authorization, payouts, or signing flow. The original
[trust boundaries](0001-trust-and-lifecycle.md) continue to apply.

## Findings in the current implementation

These are source observations at commit
`d965009f81e8f85f60971c91f704858620d5f2b3`, not a deployed-state audit:

| Boundary                | Current behavior                                                                                                     | Migration requirement                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Registry roles          | One immutable wallet per role in `KathaConfig`                                                                       | Multiple revocable operators, checked by programs on every write           |
| Historical verification | Marketplace compares earlier verifiers with the current configured verifier                                          | Rotation preserves legitimate earlier attestations                         |
| Unsold inventory        | Registry mints Core ownership to the registrar; primary listing requires `registered_by` as seller                   | Remove unrestricted inventory control from daily signing wallets           |
| Physical custody        | Katha-held custody uses the custody signing wallet as its subject                                                    | Separate organizational custody identity from the operator attesting it    |
| API administration      | Startup admin/verifier allowlists plus exact chain-role checks                                                       | Fresh role decisions, including artist approvals made only in the database |
| Financial settings      | Separate editable fee schedule; mint, treasury and inspection validity remain in immutable Marketplace configuration | Version future terms without redirecting existing offers                   |
| Artist payout           | Authority initializes immutable per-artwork payout; no artist signature required                                     | Explicit artist enrollment, consent and recovery                           |
| Wallet prompts          | Prepared operation, browser review and receipt validator each expect one instruction and one signer                  | A versioned batch contract across all three boundaries                     |

Relevant sources: [Registry](../../programs/katha_registry/src/lib.rs),
[eligibility](../../programs/katha_marketplace/src/eligibility.rs),
[purchase](../../programs/katha_marketplace/src/purchase.rs),
[API authorization](../../apps/api/src/authorization.ts),
[receipt validation](../../packages/solana/src/operation-receipt.ts), and
[browser review](../../apps/web/lib/prepared-transaction.ts).

Adding setters to existing configurations would leave historical-verifier,
custody, primary-seller and active-recipient checks inconsistent. Updating an API
allowlist alone would leave direct program calls unaffected.

## Authority model

Use a Squads v4 vault as the governance signer, subject to a local/Devnet
integration proof. The live Colosseum Solana resource index lists
[Squads Multisig](https://squads.xyz/multisig). Its listed SDK uses legacy web3.js
types; any required integration stays behind a Kit adapter. This selection does
not require changing Katha's Anchor 1.2.0 / Solana CLI 4.1.2 / Core pairing.

Create three independent member keys with a threshold of two. Keep them separate
from routine operator wallets and from each other; three accounts derived from
one compromised seed do not provide independent protection. The third key needs
an actual available custodian and a succession plan, not an inaccessible spare.

Use the **vault PDA**, not the Squads multisig configuration account, as Katha's
governance signer and as both programs' upgrade authority. Configure an autonomous
multisig with no external configuration authority that can replace members or
lower the threshold alone. Verify the chosen Squads program, vault derivation,
membership, voter permissions and threshold before accepting it. A supplied vault
address without its CPI signature grants no authority.
[Squads account model](https://docs.squads.so/main/development/reference/accounts),
[controlled multisigs](https://docs.squads.so/main/development/reference/controlled-multisigs),
[vault address guidance](https://docs.squads.so/main/navigating-your-squad/settings).

Both program upgrade authorities must move with governance. An upgrade authority
can replace program code, so leaving either one in a daily wallet bypasses the
intended protection.
[Solana deployment authority](https://solana.com/docs/programs/deploying).

The recommended initial multisig execution delay is 24 hours, including upgrades
and membership changes. This delay is a design recommendation, not an existing
setting or a production commitment. Emergency response uses the restricted
guardian below. Review the actual Squads delay semantics in local tests; do not
claim a timelock from an application countdown or add an accidental second delay.
Governance can subsequently change multisig settings through its proposal process;
the UI must expose those changes and the current threshold/delay.
[Squads configuration and execution commands](https://docs.squads.so/main/development/cli/commands.md).
[Squads documents the delay as global, beginning after approval reaches threshold.](https://docs.squads.so/main/navigating-your-squad/settings/time-locks)

| Role                       | Allowed actions                                                                                                           | Excluded powers                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Governance vault, 2-of-3   | Grant/revoke roles, activate policy revisions, approve artist enrollment/recovery, clear incident holds, upgrade programs | No implicit routine role; no unilateral artist payout substitution              |
| Catalog operator           | Create/edit drafts and artist profiles, manage permitted publication and NFC actions                                      | Authenticate artists, inspect, move assets, change financial policy             |
| Artist verifier            | Approve artist profiles after manual checks                                                                               | Enroll a replacement artist signing authority or change payout                  |
| Registrar                  | Register, mint and revise permitted metadata                                                                              | Verify its own artwork, attest physical custody, transfer inventory freely      |
| Artwork verifier/inspector | Authenticate artworks and record condition/inspection reports                                                             | Register/mint that artwork, change payout, grant roles                          |
| Custody operator           | Record allowed custody and fulfillment transitions                                                                        | Change Core ownership or treat a signature as physical delivery                 |
| Inventory sales operator   | Offer/cancel program-held primary inventory within artist-approved price and mint limits                                  | Transfer inventory directly, edit royalty/payout, sell collector assets         |
| Security guardian          | Immediately pause risk-creating operations, disable an operator, place an artwork on incident hold                        | Grant roles, enable a disabled operator, unpause, clear holds, redirect payment |
| Artist signing wallet      | Approve its own payout, royalty, primary-sale mandate and signing-wallet changes                                          | Approve another artist or change attribution                                    |
| Collector wallet           | List/cancel owned assets and purchase eligible offers                                                                     | Gain an operational role through sign-in                                        |

An operator may hold multiple compatible roles. Enforce different registrar and
artwork verifier wallets for the same artwork on-chain, including initial and
replacement verification. Role assignment cannot waive that rule. Different keys
still do not prove different people or a truthful physical inspection.

## State and authorization contract

Preserve existing fixed account layouts and immutable history. Introduce versioned
accounts and new instruction variants; publish affected IDLs and generated Codama
clients with each program change. These names describe the proposed state, not
existing generated types:

| Account                     | Owner / canonical derivation scope          | Required contents                                                                                                                             |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `RegistryGovernance`        | Registry / Registry config                  | Version, root vault, migration state, revision, pause flags, stable Katha custody identity, legacy role snapshot, deployment signature domain |
| `RoleGrant`                 | Registry / governance + wallet              | Wallet, enumerated permission bits, revision, enabled status, optional expiry; reject unknown permission bits                                 |
| `ArtworkHold`               | Registry / artwork                          | Active flag, revision, public reason commitment, incident actor and time; private incident evidence remains off-chain                         |
| `MarketplaceGovernance`     | Marketplace / Marketplace config            | Registry governance binding, migration state and revision; derive authority from Registry governance                                          |
| `MarketplacePolicyRevision` | Marketplace / config + revision             | Immutable treasury, classic SPL mint/program/decimals, inspection validity and platform fee rates; artist royalty default for new agreements  |
| `MarketplacePolicyHead`     | Marketplace / config                        | Active policy revision; expected revision required for updates                                                                                |
| `ArtistAuthorization`       | Marketplace / canonical 16-byte artist UUID | Enrolled signing wallet, pre-approved recovery wallet if any, revision, enrollment consent commitment                                         |
| `ArtworkTermsRevision`      | Marketplace / artwork + revision            | Artist identity binding, payout wallet, royalty, primary minimum price with mint, mandate expiry, artist consent commitment                   |
| `ArtworkTermsHead`          | Marketplace / artwork                       | Active artist terms revision; immutable attribution remains in Registry                                                                       |
| `InventoryRecord`           | Marketplace / artwork                       | Canonical inventory owner PDA, bound asset, explicit primary/secondary state and migration provenance                                         |
| `ListingTermsV3`            | Marketplace / listing + listing revision    | Exact policy/artist revisions and all settlement terms, canonical terms hash                                                                  |

Use stable, bounded seeds with canonical address checks, explicit owner checks,
discriminators and versions. Never accept an arbitrary caller-selected grant or
foreign governance account. Registry-owned role accounts can be read by
Marketplace without allowing Marketplace to modify them. Root rotation requires
the current vault's authorization and acceptance by the new verified vault; stale
revisions fail. Both upgrade authorities are a separate verified part of that
handover. Do not change either program ID or the existing collection to rotate a
wallet.
[Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints).

Every affected program entry point, including legacy fee and sale-term entry
points, must enforce the governance migration gate. Missing accounts, a pending
migration, paused action, disabled/expired grant or wrong role fail closed. Once
active, no old instruction may continue authorizing a legacy role/root wallet.
Cancellation and permissionless expiry cleanup remain usable during pauses and
migration, subject to their existing owner/revision/delegate checks. Neither can
transfer an asset to a new recipient or alter payment terms.

API sessions continue to authenticate identity only. Resolve permissions from
validated finalized governance and grants on every protected request, including
database-only artist approval and private evidence access; `.env` allowlists must
not preserve a revoked role. RPC failure denies protected writes. Serialize a
role-change event with its finalized slot in the audit trail. An already prepared
transaction must fail if the relevant role is revoked before execution. A database
request already executing during revocation cannot be retroactively undone;
recheck before committing protected writes and record the authorization slot.

### Preserve attestations and custody across rotation

Registry ownership and canonical account relationships establish that a historical
record was created through the program's then-authorized path. Preserve the
original signer and time; do not require that signer to retain today's role.
New attestations enforce current grants. Existing role snapshots identify legacy
claims without rewriting them or inventing an authorization history.

Revocation blocks future writes; it cannot prove when compromise began or undo
finalized malicious claims. Pause affected trading, identify impacted artworks,
hold them, and append corrected verification/inspection records after human review.
Existing immutable verification needs a versioned replacement/head path rather
than overwriting the original account. A held artwork cannot be minted, newly
listed or purchased; cancellation and expiry cleanup still work. Clearing a hold
requires governance and the required independent reinspection.

New Katha-held custody uses a stable organizational identity distinct from an
operator wallet. Legacy custody heads and their transitions remain unchanged;
validate their original subject against the captured legacy identity and retain
the same physical custody revision. Rotating a role does not create a custody
transition, renew an inspection or assert that the artwork moved. An actual later
transition records the new identity, operator and physical claim explicitly.

### Isolate unsold inventory

New primary inventory is owned by a canonical Marketplace inventory PDA. Registry
mints to that address, while Marketplace permits only its defined primary listing,
cleanup and atomic-sale paths. There is no generic operator transfer instruction
or permanent transfer delegate on collector-owned assets. Track the initial
inventory authority separately from immutable `registered_by` attribution.

An inventory sales operator cannot invent a low price: an artist-approved mandate
binds the artwork, mint, minimum primary price and expiry. Its listing must meet
that mandate and the quoted platform fee. Purchase pays the artist after the
primary commission; inventory ownership does not make the operator a recipient.
The normal current-owner signature remains mandatory for collector resales.

Migrating an existing unsold asset requires the actual current Core owner's
signature, inactive/clean delegates, artist terms and live ownership checks.
Governance cannot recover an already stolen asset by rewriting `registered_by` or
forcing a collector transfer. Existing active primary offers must settle or be
cancelled/unlocked before that asset enters program inventory. Preserve permanent
IDs, Core addresses, collection membership and completed-sale counts.

## Editable financial settings and artist consent

Retain defaults: **10% primary platform fee, 2.5% resale platform fee and 5%
artist resale royalty**. Apply percentages to gross sale price with checked integer
arithmetic and deterministic rounding. A resale may lose money; there is no
appreciation assumption or royalty calculated only on profit. Primary proceeds go
to the artist after commission. Secondary proceeds go to seller, artist and
treasury. Enforce the existing mathematical bounds: primary commission cannot
exceed 10,000 bps; secondary commission plus the agreed royalty cannot exceed
10,000 bps. Expose exact distributions before signing.

Governance changes treasury, payment mint, validity and platform fees through new
policy revisions. Financial changes follow the governance notice/delay process
and apply to future listings. Keep the current six-decimal classic SPL constraint
and no freeze authority; validate mint ownership, decimals, token program and
recipient accounts. Supporting arbitrary decimals or Token-2022 is separate work.
A new mint needs a new explicit integer-denominated price and artist mandate;
do not convert balances or relabel old prices as another currency.

An artwork's agreed royalty and payout are changed only with its enrolled
artist's consent. The platform royalty setting supplies a default for new
agreements; it cannot overwrite agreements on existing artworks. The optional
creator wallet, payout recipient, signing authority and immutable artist UUID are
separate fields. Initial enrollment needs governance approval, manual identity
verification and a signature from the artist wallet being enrolled. Existing
admin-entered payouts do not establish artist consent by themselves.

Artist approvals sign a versioned, canonical UTF-8 message with fixed field order
and explicit labels so the wallet can display the terms being approved. Restrict
values to canonical identifiers, addresses and integer strings; reject ambiguous
encodings or embedded separators. Program and shared-client test vectors must
agree on the exact signed bytes.
Bind the action, application domain, configured genesis/deployment domain, both
program IDs, governance account, artist UUID, artwork scope, current authorization
and terms revisions, complete new terms, nonce and expiry. The new authority also
accepts an artist signing-wallet rotation. A message for one artwork or cluster
cannot authorize another. Do not include personal evidence in signed public bytes.
The configured deployment domain must be verified during bootstrap; a stored hash
alone does not independently establish which network a program is running on.

Use Solana's Ed25519 verification instruction and program-side instruction
introspection. Require the exact expected public key and message bytes, restrict
signature data offsets to the verified instruction, and consume the revision/nonce
atomically with the update. API-only signature verification leaves a direct-call
bypass. Enforce message expiry with chain time and reject stale revisions/replay.
Artist messages are approvals, not backend custody of an artist's key.
[Solana precompile format](https://solana.com/docs/core/programs/precompiles) and
[instruction introspection](https://solana.com/docs/core/instructions/instruction-introspection)
define the underlying checks. Precompiles cannot be invoked by CPI: when a
governance execution needs artist consent, its Ed25519 instruction must appear at
the top level before the Squads execution, with that exact artist message bound to
the inner Katha action. Choose expiry to allow the governance delay; an expired
approval must be obtained again, never extended by the server.

Lost-access recovery requires the pre-enrolled recovery wallet and governance,
with a proposed seven-day challenge period, public pending status and cancellation
by the current artist signing wallet. Recovery re-enrolls an authority; future
payout changes still require that authority's approval. If no recovery wallet was
approved, suspend new offers for that artist and resolve identity/consent manually;
do not provide a root-only payout replacement shortcut. Governance cannot silently
rewrite existing artist terms. Two compromised governance members can nevertheless
replace program code; this design does not claim immunity from that threat.

### Freeze all active listing economics

Version-3 listings snapshot treasury, mint, token program, decimals, commission,
artist payout/royalty, inspection validity, artist/policy revisions, price and
expiry. Purchase uses those exact terms, including the validity used to evaluate
the current owner/custody-scoped inspection. A policy change does not renew an
inspection or change the inspection scope. Recheck holds and all lifecycle facts.
Listing preparation and execution bind expected policy and artist revisions and
the complete terms hash; reject a change between review and execution. Buyer
review and purchase bind listing revision, price and the same terms hash.

Version-1 and version-2 offers retain their existing configuration/fee-snapshot
rules and recipients. Keep the old singleton values frozen so older offers cannot
be redirected. Before activating governance, prove both legacy purchase branches
and cleanup still work with the added authorization gates. Disable legacy creation
paths after cutover; do not offer a caller-selected fallback around version-3 terms.

If an old payout or treasury is compromised, pause affected purchases and have
authorized sellers cancel/relist after recovery, or use valid expiry cleanup.
Do not replace the recipient underneath an already signed offer. The UI must show
that such offers are paused. Root changes never reset sale history or turn a
secondary sale into a primary sale.

## Reduce artwork signing prompts

The current separation is an application choice, not a Solana requirement for one
signature per instruction. A transaction can contain compatible instructions and
commits atomically. Each distinct required signer still authorizes its part.
[Solana transactions](https://solana.com/docs/core/transactions).

Target these review groups after real manual decisions are complete:

| Review group         | Signer / target bundle                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Artist onboarding    | One artist enrollment approval; reusable wallet session; root enrollment is not repeated per artwork                    |
| Artist artwork terms | One artist message approving payout, royalty and primary price/mint mandate                                             |
| Artwork registration | Registrar: register identity + initialize metadata                                                                      |
| Artwork approval     | Independent verifier: authenticate + initialize condition after actual inspection                                       |
| Physical custody     | Custody operator: explicit transition after actual handling                                                             |
| Ready for sale       | Registrar and inventory-sales role: mint + list when the same wallet holds both roles and the measured transaction fits |

This targets four routine on-chain approval groups per artwork, plus artist consent
and any separately required terms-anchoring transaction. It is a target, not a
verified prompt count. Keep mint/list separate if measured limits or distinct
authorized wallets require it. Batch multiple artworks for the same role only
with bounded size and an itemized review. Do not repeatedly sign in while a valid
session for that wallet/origin/cluster remains. Artist-profile approval itself is
currently a database action; it does not require a new on-chain signature.

Introduce a version-2 prepared-operation envelope with an ordered instruction
manifest, exact account roles/data, signer set, fee payer, cluster, message hash,
resource configuration, expected effects and one batch identity. Browser review
and finalized receipt validation must bind the complete sequence, including allowed
Ed25519 verification instructions. Reject hidden extra instructions, privilege
escalation, recipient substitution, reordered instructions and missing signatures.
Preserve strict version-1 receipt handling for already prepared operations.
Governance receipts need a distinct validated Squads execution path: resolve the
exact vault proposal/message and inner Katha calls rather than requiring a Katha
instruction at the outer level or trusting a matching log string. Ordinary
operator batches cannot accept an arbitrary CPI wrapper as an alternate authority.

Estimate compute and loaded-account resources through simulation, bound fees and
serialized size, and check wallet transaction-version support. Rebuild and re-review
after message/blockhash changes; signatures cannot move to a different message.
Never interpret `signAllTransactions` as atomicity across different transactions.
A failed instruction rolls back the whole batch; an uncertain submission must
reconcile the original signature before preparing a retry. Index all successful
effects once, exclude failed batches, and commit batch receipt/projections together.

## Migration and release gates

This is one design handoff. The following implementation work is pending; each
change carries its own authorization/failure tests and review handoff.

1. **Governance and roles:** implement versioned governance/grants, emergency
   pause/hold, safe legacy-history validation, independent verification and fresh
   API authorization. Cover every privileged legacy entry point. New financial
   policy cannot activate while the old authority path remains reachable.
2. **Inventory and terms:** implement constrained primary inventory, artist
   enrollment/approval/recovery, policy revisions and version-3 listing snapshots.
   Preserve legacy settlement and cleanup; update quotes, UI, receipts and indexer.
3. **Signing groups:** implement the complete batch contract across shared schemas,
   builders, operation persistence, browser, wallet boundary and receipt/indexing
   code. Measure the target bundles before promising fewer prompts.
4. **Devnet migration rehearsal and user execution:** first rehearse against
   synthetic local fixtures, including upgrade from existing account bytes. Produce
   a concrete transaction manifest for the user; do not initialize old singletons
   again or run authority changes automatically.

The migration manifest must include network/genesis, program IDs, binary hashes,
both ProgramData addresses and old/new upgrade authorities, collection and authority,
legacy config hashes/layouts, target multisig and vault/program, verified members,
threshold/delay/config authority, grants, policy revisions and affected inventory.
Never include signing material or private evidence. Explicitly select Devnet; the
Squads CLI documentation lists mainnet as the RPC default.

Quiesce new preparations and pause through available controls. Before governance
code exists, there is no on-chain pause to invoke: stopping the API alone does not
block direct calls. Upgrade both programs to code that requires staged governance
and denies risk-creating legacy calls until activation. Initialize each new
governance account using its current legacy config authority plus acceptance by
the new vault. Verify both bindings, transfer both upgrade authorities, and verify
finalized ProgramData. Activate both governance states in one atomic transaction
after staging and compatibility checks. Keep risk-creating operations blocked if
any prerequisite fails; cleanup remains available. A recorded owner-signed inventory
migration can occur per asset after global activation.

After activation, there is no downgrade switch restoring a former hot wallet.
Recovery is a reviewed forward upgrade authorized by governance. Cancelling offers
and unlocking assets must remain possible throughout. Update public deployment
records only from finalized receipts and verified binaries, with the user's actual
wallet approvals.

Required acceptance evidence, all **pending**:

- [ ] Real Squads execution succeeds with two approvals; one member, wrong vault,
      controlled multisig, wrong program and missing CPI signature fail.
- [ ] Both upgrade authorities and the two Katha governance bindings agree; staged
      or partially upgraded state cannot expose an old privileged route.
- [ ] Multiple operators work; revocation/expiry, old sessions and pre-prepared
      transactions cannot retain revoked privileges; RPC failure denies API writes.
- [ ] Registrar cannot verify its own artwork or freely transfer inventory; price,
      mint and expiry mandate failures leave Core and payments unchanged.
- [ ] Rotation preserves earlier valid verification/custody and both legacy sale
      branches; incident holds prevent mint/list/purchase but permit cleanup.
- [ ] Artist impersonation, altered messages, cross-network/artwork replay, reused
      nonces, bad offsets and expired/stale approvals fail on-chain. Recovery needs
      the enrolled recovery authority, threshold approval and challenge period.
- [ ] Treasury/mint/fee/validity/payout changes affect only future offers; exact
      legacy/v3 balances, expiry boundaries and checked arithmetic are verified.
- [ ] Batch tampering, missing/coerced signer roles, failed last instruction and
      expired messages fail safely; retry/reconciliation and replay index once.
- [ ] Both custody/resale browser journeys, generated client determinism and all
      relevant program/API/web tests pass against isolated synthetic fixtures.
- [ ] User verifies the Devnet authority transfer and actual wallet prompt counts;
      real physical inspection, handling and NFC acceptance remain separate.

This design reduces the power of a stolen daily key. It cannot undo completed
transactions, prove physical authenticity, recover missing keys without an agreed
recovery path, or prevent two compromised governance members from authorizing
malicious upgrades. No production security certification follows from this ADR.
