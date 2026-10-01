# Registry artwork authentication

`verify_artwork` records one Katha authentication attestation for a registered
artwork. The signer must match `KathaConfig.verifier_authority`. The program
checks the canonical configuration PDA, the artwork PDA derived from its
permanent Katha ID, and the artwork's configured Core collection. The verifier
supplies the authorship evidence hash they inspected; it must match the
immutable hash committed at registration.

Successful verification creates an `ArtworkVerification` account at the Registry
PDA seeded by `["verification", artwork address]`. It stores the artwork
address, accepted evidence hash, verifier address, on-chain timestamp, and PDA
bump. This account's absence means `UNVERIFIED`; its presence means `VERIFIED`.
A second verification fails because the PDA is already allocated. The
`ArtworkVerified` event records the same artwork, Katha ID, evidence hash,
verifier, and timestamp for later indexing. The registered artist, category,
creation year, and optional creator wallet remain unchanged.

This attestation records a Katha verifier's claim after the manual review. It
does not independently prove physical authenticity or change physical custody.
Condition inspections, metadata commitments, and Core minting are separate
steps. Private inspection material stays outside the chain account and Git;
only its approved commitment belongs in this trust record.

`pnpm program:test` uses synthetic signers in LiteSVM to test authorization,
wrong configuration and artwork relationships, hash mismatch, wrong collection,
identity mismatch, successful attestation, and duplicate rejection. The normal
Anchor build generates `target/idl/katha_registry.json`; generated application
clients are scheduled for the later client-generation step.

The checks use [Anchor account constraints](https://www.anchor-lang.com/docs/references/account-constraints)
and an [Anchor event](https://www.anchor-lang.com/docs/features/events).
