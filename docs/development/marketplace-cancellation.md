# Listing cancellation and expiry recovery

`cancel_listing(expected_revision)` requires the recorded seller's signature.
It is valid before or after expiry. `expire_listing(expected_revision)` accepts
any signer once chain time is greater than or equal to the recorded expiry.
Expiry does not automatically run a transaction: someone must submit cleanup.
These are program instructions; API and collector controls arrive later.

Both require an active canonical listing with the exact reviewed revision. They
validate Marketplace/Registry configuration, artwork and Core asset PDAs, collection,
current Core owner and the listing's frozen Freeze Delegate authority. They do not
require a fresh inspection or sale-eligible custody: a seller must be able to
unlock an artwork when its approval or custody changes.

The listing PDA signs Core CPIs to thaw the asset and revoke its temporary Freeze
Delegate and Transfer Delegate authority back to the owner. An absent or
owner-revoked transfer delegation cannot trap the asset; cleanup leaves unrelated
transfer permissions alone. A foreign Freeze Delegate is rejected rather than
thawed. Core's [revocation interface](https://www.metaplex.com/docs/smart-contracts/core/plugins/delegating-and-revoking-plugins)
permits self-revocation. Actual Core execution requires owner approval for plugin
removal, so permissionless expiry uses revocation instead. The owner-managed
plugins remain attached and storage rent stays in the asset; callers receive no
rent reward. Relisting reapproves only these owner-managed Transfer Delegate and
unfrozen Freeze Delegate plugins on an existing ledger. Unrelated plugins or
foreign delegated authorities still fail creation; first listings require empty
plugin registries.

The existing ledger remains allocated. Status becomes `Cancelled` or `Expired`
and revision increases with checked arithmetic. Price, seller, attestation scope,
completed-sale count and other historical terms remain intact. `ListingReleased`
emits public identity, actor, terminal status, revision and chain timestamp.
Core ownership, Registry authorship and physical custody do not change.

All CPIs, ledger changes and events commit together. Early expiry,
unauthorized cancellation, stale revisions, invalid accounts or any subsequent
transaction failure leave the active record and lock unchanged. Repeated cleanup
fails. Relisting requires the terminal revision and rechecks current eligibility;
a delayed instruction for an older offer cannot unlock the new revision. Owner-managed delegates left by cleanup are reused on relisting.

## Verification

```bash
pnpm program:build
pnpm codegen:check
cargo test --workspace --locked
pnpm program:test
```

Real Core/LiteSVM tests cover cancellation, permissionless inclusive expiry,
unchanged storage rent, duplicate/stale calls, account and signer substitution, complete
transaction rollback, cancellation during transit custody, owner-revoked transfer
authority, successful post-release transfer and relisting, revision overflow and persistent
completed-sale history. All identities are
synthetic and temporary. No purchase or settlement is implemented here.
