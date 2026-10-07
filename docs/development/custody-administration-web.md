# Custody and fulfillment administration

Open `/admin`, enter a permanent Katha ID, then choose **Open custody coordination**.
The protected page is `/admin/artworks/:kathaId/custody`. Sign in with a wallet on the
configured localnet or Devnet cluster. Administrator allowlist membership grants
private request access; the current Registry custody authority independently grants
custody signing. Verifier membership alone grants neither.

The page shows finalized physical custody, its exact decimal-string revision,
physical custodian and current Core owner separately. Requests appear in pages of
20, newest first with a stable UUID tie-breaker. Closed requests remain readable
for coordination history. Contact, address, delivery instructions, courier and
tracking details are private, collapsed by default and cleared on sign-out,
wallet changes or authorization failure. They are never included in transaction
requests, canonical metadata, public artwork responses or provenance.

## Record an actual movement

1. Inspect saved custody and the current owner. Reload if another operator has acted.
2. Select an eligible related request, or a manual custody attestation. The choices
   follow the shared physical transition graph from the current state.
3. For a collector destination, confirm the receiving wallet. Minted artwork uses
   the current Core owner; an unminted work requires an explicit collector wallet.
4. Confirm that movement has already occurred and that the custodian is correct.
5. Prepare the unsigned attestation. Review its operation, accounts, revision,
   simulation and fee before separately approving the wallet signature.
6. Check finalized receipt and indexing feedback, then reload custody state.

Initialization records Katha or collector custody from UNKNOWN. Held artwork may
be dispatched into IN_TRANSIT, then received by Katha or a collector. Custody
instructions preserve artist attribution and do not transfer Core ownership.
The connected wallet never signs just because a form was saved or prepared.

The browser decodes the generated Registry instruction before simulation/signing.
It binds action, collector, current/next revision, canonical artwork/config/head/
transition accounts, authority, system program and account roles to the review.
Extra instructions/accounts or a mismatched operation fail closed. The existing
transaction flow validates the returned signature against the exact prepared bytes,
persists the signed attempt before broadcast and checks the protected receipt for
that signature's finalized/indexed state. Simulation follows the
[official RPC contract](https://solana.com/docs/rpc/http/simulatetransaction).

An UNKNOWN receipt blocks replacement custody preparation in the browser, API and
transactional database guard. Artwork locking serializes preparation with receipt
writes. Historical finalized movements do not block a later movement; a newer
failed or unresolved receipt is not hidden by older finalized history. Retained
unknown signatures require reconciliation, never a blind replacement.

## Coordinate a private request

Expand a request only when coordinating its delivery. The legal sequence is
REQUESTED → APPROVED → DISPATCHED → RECEIVED; REQUESTED/APPROVED may be cancelled.
Approval, dispatch and receipt require the requester to remain the current Core
owner. A stale request can only be cancelled when its status permits it. Courier
and tracking details may be set before dispatch and cannot change after dispatch.

For a linked dispatch, approve the request, record and finalize physical dispatch,
then manually save DISPATCHED. For a linked receipt, keep the request DISPATCHED,
record and finalize receipt, then save RECEIVED. Saving a request status does not
record physical movement on chain. Physical work remains manual; do not record a
movement based solely on the request's status.

Each status change requires explicit confirmation and an optimistic timestamp.
Conflicts or uncertain writes require reloading saved state before retrying. A
custody transaction in progress blocks conflicting form actions. Request creation
by collectors and delivery-request UX enter the later collector phase.

## Verification

Run `pnpm --filter @katha/shared test`, `pnpm --filter @katha/api test`,
`pnpm --filter @katha/web test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm format:check`, `pnpm codegen:check` and
`pnpm --filter @katha/web test:public-journeys` after building.

Tests use synthetic shipping/contact data and generated unsigned instructions.
Browser fixtures cover explicit confirmations, stale writes, separate status and
custody actions, unresolved attempts, wrong signing authority and revoked-role
privacy at mobile, tablet and desktop widths. No live wallet signing or physical
movement is performed by these checks.
