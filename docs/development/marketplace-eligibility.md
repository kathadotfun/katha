# Listing records and sale eligibility

Marketplace now defines a bounded, versioned `ListingRecord` and provides a
read-only `check_sale_eligibility` instruction. Listing creation and asset locking are described in [listing creation](marketplace-listings.md).
Cancellation and purchase are subsequent features. A successful preview does not
reserve eligibility; those instructions must revalidate live accounts when executed.

## Immutable artist payout

`initialize_sale_terms` binds one non-default artist payout address to a canonical
Registry artwork. Only the configured Marketplace authority may initialize its
`["sale-terms", artwork]` PDA. The account is 74 bytes including discriminator,
version, artwork, payout and bump. There is no update/close path. A duplicate
initialization cannot replace the recipient.

The creator wallet remains optional attribution. It is neither a mandatory payout
wallet nor a substitute for a platform-approved payout recipient. The administrator
must verify the actual artist's payout authorization before signing this economic
binding; the chain cannot infer that relationship from the wallet address.

## Persistent listing layout

One 320-byte `ListingRecord` is keyed by `["listing", asset]`. It contains:

- version, Marketplace configuration, artwork and Core asset;
- seller, immutable artist payout and configured payment mint;
- exact integer price and creation/expiry timestamps;
- condition report address, version and hash, and physical custody revision;
- listing revision, completed-sale count, primary/secondary kind, status and bump.

Status is `Inactive`, `Active`, `Cancelled`, `Expired` or `Purchased`. It does not
replace custody, verification, approval or Core ownership. Listing revisions use
checked incrementing arithmetic. Price must be positive and expiry strictly later
than a positive chain timestamp; amounts fit `u64` and never use floating point.
`create_listing` now activates this ledger through validated Core locking.

The ledger must persist across cancellation, expiry and purchase. Completed sales
will classify a new offer as primary (zero) or secondary (positive); returning the
asset to its original owner must not reset economic history. A primary offer
requires the original Registry registration authority, which received the minted
Core asset, to remain its owner. Initial proceeds still belong to the artist.

## Account and eligibility checks

All Registry accounts use their pinned program ID, owner, discriminator and PDA
relationships. Foreign PDA validation uses
[Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints).
Marketplace configuration and payout terms must have supported versions. The Core
asset must be the Registry-bound deterministic address, owned by Core, with the
registered Katha name and configured collection update authority. Its actual owner
must sign as seller. Verification must match the immutable authorship commitment
and authorized verifier; the current condition head must select the supplied
report with matching version/hash and authorized verifier.

The optional decoded listing account has a mandatory companion canonical ledger
address. When no decoded listing is provided, that address must be empty and owned
by the System program. An existing history account cannot be omitted to claim a
primary sale. When present, it must be the same canonical address and match the
configuration, artwork, asset, payout and mint. For an absent ledger, generated
clients currently need the Marketplace program address as the optional `listing`
sentinel; `listingAddress` always resolves to the canonical ledger PDA.

Unknown or in-transit custody is ineligible. Katha-held custody must name the
configured custody authority. A current initial unscoped inspection may be reused
only at custody revision 1. A later report must match the current custody revision.
Continuous Katha custody permits reuse across digital ownership changes without
the collector inspection expiry rule. Dispatch and return change the revision, so
old approval cannot revive merely because the work returns to Katha.

Collector-held custody must name the actual selling owner. Primary offers require
a `PreSale` report; secondary offers require `PreResale`. The current report must
scope both that owner and that custody revision. Inspection must not be in the
future and must be within configured validity, including the exact boundary
(default: 30 days). Insurance and post-delivery reports do not substitute for
collector resale approval. Grades remain disclosed condition information rather
than an invented automatic prohibition on selling a particular grade.

## Local verification

```bash
pnpm program:build
pnpm codegen
pnpm codegen:check
cargo test --workspace --locked
pnpm program:test
```

Rust tests cover bounded serialization, revision overflow, exact price/expiry
bounds, inspection reasons, scope, validity and custody changes. LiteSVM exercises
real Marketplace configuration, payout binding, Registry/Core identities,
authorization and real custody/inspection instructions. Adversarial account bytes
exercise forged ownership, incorrect relationships, report hashes and versions.
Until settlement exists, hypothetical completed-sale ledger bytes are installed
explicitly for eligibility tests; they are not evidence of an executed purchase.
All signers/documents are synthetic and have no production purpose.

The existing exact Core Rust pin `0.12.1` is now a direct Marketplace dependency
for parsing live assets. No toolchain or dependency version was upgraded. Larger
read-only accounts are boxed to keep Anchor validation inside the SBF stack limit.
