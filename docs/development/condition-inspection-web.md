# Condition inspection administration

Use **Open condition inspection** from authenticity review or the permanent-ID
lookup on `/admin`. The protected page is `/admin/artworks/:kathaId/condition`.
It has no search indexing and server rendering contains no private report data.
Sign in with a verifier allowlisted on the configured localnet/Devnet cluster and
the current Registry `verifierAuthority`. Admin membership alone is insufficient.
Artist verification, registration and artwork authenticity must already exist.

## Inspect and save

Physically inspect the artwork and match its permanent identity. The page reads
finalized Registry/Core accounts, validates their owners, discriminators and PDA
relationships, and displays the current condition version. Unminted reports have
no ownership scope. Minted reports bind the current Core owner, physical custody
state and custody revision. Transit is ineligible. Katha-held and collector-held
inspections keep ownership and custody separate.

Append private PNG/JPEG/WebP/AVIF inspection images, within the displayed upload
limit. File signatures, exact bytes, SHA-256 and storage visibility are checked.
Appending evidence is permitted after documentation freezes, but existing media,
ordering and public metadata remain unchanged. The artwork retains its existing
20-media-item limit. Private images have no public download URL or browser preview.
Keep originals and actual inspection records in approved private storage outside Git.

Select a grade, an eligible reason, the inspector's record UUID, actual inspection
time, private notes and one or more distinct saved images. The inspector UUID
initially uses the signed-in wallet record ID; change it only to the correct private
inspector record identifier. Dates use the browser's local timezone and are saved
as UTC; on-chain inspection time uses seconds. The reported time is generated at
save. Future or reversed timestamps, blank notes and invalid selections fail.
Owner and custody scope are read-only and must match the latest finalized state.

Confirm that you performed the physical inspection, then **Save private condition
report**. The canonical report and its exact-byte SHA-256 are saved in PRIVATE
storage. Each new report has an immutable UUID and local version; earlier versions
remain preserved. The browser independently checks the returned canonical bytes,
hash, permanent identity and selected evidence. A saved report is not an attestation.

## Attest and reconcile

Review **Review exact private canonical report** and the saved digest. Approve the
report separately, then **Prepare and simulate the report transaction**. Initial
inspection uses INITIAL_VERIFICATION. Later unminted reports use PRE_SALE or
INSURANCE; minted reports offer the eligible follow-up reasons. Chain condition
versions and local report versions are separate counters.

The browser binds the generated instruction's report UUID/hash, grade, reason,
inspector UUID, inspection time, condition version and minted owner/revision to the
reviewed report. It validates artwork, config, verification, condition head, report,
custody and asset PDAs as applicable, the signer, system program and account roles.
A changed owner or custody revision requires a new report and review. Simulation
uses the existing [Solana RPC contract](https://solana.com/docs/rpc/http/simulatetransaction)
and does not establish success. **Approve in wallet** remains separate.
See [wallet transaction lifecycles](transaction-lifecycle-web.md).

Signed bytes are checked, the signature is retained before one broadcast, and the
API reconciles its finalized outcome. **Reload inspection state** shows retained
report-specific receipts. UNKNOWN signatures block new evidence, reports and
replacement attestation preparation, including attempts for earlier reports.
An uncertain save requires reload before retrying. A refresh does not retain signed
transaction bytes or restart submission; preserve the displayed signature and use
[receipt reconciliation](operation-receipts-api.md) to resolve it before replacement.
Unsigned preparations do not reserve state, so execution still checks chain invariants.

FINALIZED receipts and indexed events are shown separately. A receipt does not
finalize the local report projection until indexing applies the corresponding event.
Protected indexing feedback matches artwork, program, cluster and signature for
the selected report hash. If another report becomes latest while an earlier receipt
awaits indexing, retain and reconcile that earlier signature separately. Sign-out,
wallet changes and permission revocation clear protected review data and late responses.

This records a verifier's condition claim. Physical inspection remains manual;
authority signatures and NFC do not independently prove physical condition. This
workflow does not approve resale, change custody, transfer ownership, mint or publish.

## Checks

Run `pnpm --filter @katha/shared test`, `pnpm --filter @katha/solana test`,
`pnpm --filter @katha/api test`, `pnpm --filter @katha/web test`, `pnpm db:test`,
`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm format:check`,
`pnpm codegen:check` and `pnpm --filter @katha/web test:public-journeys`.
Tests use synthetic private images/documents, finalized account fixtures and temporary
in-memory signing identities. Browser tests cover uploads, report review, conflicts,
simulation/cancellation, retained signatures, indexing delays and permission revocation
at mobile/tablet/desktop widths. No real inspection or wallet approval is automated.
