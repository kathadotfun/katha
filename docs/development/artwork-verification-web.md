# Artwork authenticity administration

Open **Review artwork authenticity** from saved documentation or finalized
registration. A verifier without admin permissions can use the permanent-ID lookup
on `/admin`. The review lives at `/admin/artworks/:kathaId/verification` and has
no search-engine indexing. No private data is included in the server-rendered page.

## Before approval

Sign in on the configured localnet/Devnet cluster. The API verifier allowlist is
required for read access; transaction preparation also checks the current finalized
Registry `verifierAuthority`. Admin membership alone grants neither permission.

Finish artist verification, artwork documentation, approved public metadata and
registration first. The browser requires a locally reconciled finalized registration.
Inspect the actual physical work, match its permanent identity and review original
authorship evidence and attribution. Retain the inspection record and evidence in
approved private storage. Do not enter names, contact information, private photos,
notes or evidence bytes into public metadata or Git.

Compute SHA-256 from the exact evidence bytes used when registering the artwork.
Enter only that lowercase digest in **Reviewed evidence SHA-256**. The digest must
match the registered commitment. If it does not, investigate the original evidence;
do not alter registered attribution to bypass the mismatch. A matching digest only
checks consistency of the reviewed bytes; the verifier performs authentication.

Review the displayed identity and exact public metadata. The browser independently
checks canonical bytes, SHA-256 and document identity. Confirm physical inspection
and authorship review separately. Both confirmations and the matching digest are
required before **Prepare and simulate verification**. Preparation retains the
manual authenticity confirmation and evidence digest in the private operation intent;
it does not save raw evidence or create a condition report.

## Wallet approval and outcome

Preparation uses the shared request schema, saved timestamp and selected metadata
UUID. A stable wallet/version idempotency key supports unchanged unsigned retries.
Changed authority, stale state, integrity failure, unresolved signed attempts and
already verified artworks stop preparation. An uncertain write requires an explicit
reload, with no automatic replacement or signing.

The shared transaction controller binds the decoded Registry instruction to the
reviewed evidence digest and permanent artwork PDA. It checks the verification PDA,
config, signer, system program and exact account roles, then simulates and displays
the fee, accounts and lifetime. **Approve in wallet and submit** is a separate action.
See [transaction lifecycles](transaction-lifecycle-web.md). Solana's
[simulation contract](https://solana.com/docs/rpc/http/simulatetransaction) permits
unsigned simulation when signature verification is disabled; simulation does not
establish finalization.

The controller validates the returned signed bytes, records the signature before
broadcasting once, and reconciles the finalized receipt through the API. Failed or
unknown outcomes do not establish authenticity. **Reload verification state** shows
retained receipt status after navigation or reload. An unresolved signature blocks
replacement preparation; preserve it for manual receipt reconciliation. Browser
refresh does not retain the signed transaction bytes or restart submission.

**Artwork verification finalized** means a finalized verification record or validated
receipt exists. **Finalized; verification indexing pending** is separate from
**Verification event indexed**. Protected indexing feedback matches the exact
artwork/program/cluster/signature, so unpublished artworks can complete this review.
Signing, preparation and indexing alone never imply success. Sign-out, wallet change
or permission revocation clears protected review data and discards late responses.

Verification records a human authenticity claim. It does not independently prove
physical authenticity, mint, publish, transfer ownership, change custody or record
condition. Condition inspection, custody and publication use later workflows.

## Verification

Run `pnpm --filter @katha/shared test`, `pnpm --filter @katha/api test`,
`pnpm --filter @katha/web test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm format:check`, `pnpm codegen:check` and
`pnpm --filter @katha/web test:public-journeys`.

Tests use synthetic artwork and evidence digests, mock chain responses and temporary
in-memory signing identities. Chromium exercises verifier-only access, mismatched
evidence, stale preparation, simulation/cancellation, unresolved receipts, finalized
indexing delay and permission revocation at mobile/tablet/desktop widths. Actual
physical inspection and real wallet approval remain operator actions.
