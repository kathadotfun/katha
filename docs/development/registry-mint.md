# Registry Core asset minting

`mint_artwork` creates and binds one Metaplex Core asset for a permanently
registered artwork. The asset address is the Registry PDA
`["core-asset", artwork address]`; callers cannot choose a different address.
The configured registration authority signs and pays Core creation rent, and is
the asset's initial digital owner for a later primary listing. Physical custody
and permanent artist attribution remain independent.

Before calling Core, the Registry requires the canonical artwork and configured
collection, the verifier's authentication attestation, the current versioned
metadata commitment, the version-1 initial-verification condition report, and
attested Katha or collector custody. Transit custody is ineligible. The Registry
also checks the configured collection-authority PDA is still the Core collection's
update authority. An existing asset account or existing artwork binding is rejected.

The Registry signs the Core `CreateV2` CPI with the asset and collection-authority
PDAs. Core creates the asset in the configured collection using the permanent
Katha ID as its on-chain name and the current committed metadata URI. For an asset
in a collection, Core derives its update authority from that collection; the CPI
does not supply a separate asset update authority. The Registry then stores the
asset address in the artwork account and emits `ArtworkMinted` with the relevant
metadata, initial inspection, custody revision, owner, and timestamp. The CPI,
binding, and event are one Solana transaction. A failed CPI leaves no asset or
binding. Retrying a successful mint cannot create another asset.

Core remains authoritative for current digital ownership. The Registry address is
a permanent identity binding, not an ownership cache. Later sales transfer Core
ownership without changing the artist or custody records. Post-mint metadata
revisions use `revise_minted_metadata` to synchronize Core's URI and the Registry
hash atomically; see the [metadata commitments guide](registry-metadata.md).

`pnpm program:test` exercises the real Core CPI in LiteSVM, including wrong
signers, account/PDA substitution, missing or stale prerequisites, transit
custody, insufficient rent, duplicate minting, and atomic rollback. The normal
Anchor build regenerates `target/idl/katha_registry.json`; generated application
clients are scheduled for step 035.

See the [Metaplex Core CPI reference](https://www.metaplex.com/docs/smart-contracts/core/using-core-in-anchor)
and [Solana transaction pipeline](https://solana.com/docs/core/transactions/transaction-pipeline).
