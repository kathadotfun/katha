# Wallet transaction lifecycle

The wallet provider now owns a reusable transaction controller and review panel.
The [registration administration workflow](artwork-registration-web.md) supplies
prepared Registry operations to this common simulation, approval, submission and
confirmation boundary. Public browsing and sign-in never initiate a transaction.
There is no raw transaction paste form, demonstration transfer or automatic signing.

## Configuration and preparation

Pass the same configured Localnet/Devnet cluster to the API and web process.
`KATHA_PUBLIC_SOLANA_RPC_URL` optionally selects a browser-visible RPC. Defaults:
`http://127.0.0.1:8899` for localnet and `https://api.devnet.solana.com` for Devnet.
This is separate from server-only `KATHA_RPC_URL`; private server settings are never
forwarded. Do not put credentials or API keys in public configuration. URL userinfo,
query strings, fragments, known mainnet/testnet endpoints and insecure Devnet HTTP
are rejected. For LAN browsers use a reachable local RPC with suitable CORS.
The browser checks RPC genesis against the selected cluster before chain requests.

`useTransactionLifecycle()` returns the provider's controller to its consumers.
Call `load(response, { kind, kathaId })` with the authenticated API preparation and
the independently expected operation identity. It validates shared response schemas,
canonical wire encoding, message SHA-256, version, recent blockhash, fee payer and
sole required signer. Generated Codama clients identify/decode the single Registry
instruction and validate artwork/config PDAs. A registration's encoded Katha ID
must also match the expected ID. Unknown programs, extra instructions, signed
preparations, mismatched accounts/identity and unsupported versions fail before
wallet approval. Registration additionally compares the decoded artist UUID, creator wallet, category,
year and evidence digest to the independently reviewed identity. Domain-specific forms must review their parameters; the API and
program still enforce the complete authorization and lifecycle rules.

Only the existing browser-safe generated Registry export and RPC-cluster helper
are imported from the Solana workspace. Kit handles transaction codecs and RPC;
no Umi, legacy web3.js or authority key is added to the UI. Registry preparation
versions remain unchanged: localnet v0; compatible Devnet v0/v1. A version is never
changed in the browser, because doing so would break the retained message binding.

## Simulation and explicit approval

Loading an operation checks block height, simulates the exact unsigned bytes without
replacing the blockhash and estimates the network fee. Simulation uses at least the
API's simulation slot and rejects an execution error, stale response or unavailable
fee. The review panel displays operation/artwork identity, intended test cluster,
version, authority/fee payer, estimated network fee in integer lamports, affected
account privileges and message commitment. Registry operations contain no token
payment; account creation rent may additionally apply and is not estimated here.
Simulation is a check, not a guarantee of execution success.

**Approve in wallet** is the only signing trigger. The controller checks
identity/lifetime and reruns simulation before prompting. If the fee estimate changes,
it returns to review and requires approval again. The wallet adapter uses only Kit's
separate modifying signer (`solana:signTransaction`), never a wallet's combined
sign-and-send feature. Wallets lacking separate signing or the prepared version
cannot submit through this boundary.

After approval, the browser requires an unchanged message and verifies the actual
Ed25519 signature from the expected wallet. It rechecks account/session and lifetime.
A rejected or changed signature never broadcasts. Cancellation and account/session
changes invalidate pending work; late wallet/RPC responses cannot resume submission.
Cancelling a wallet prompt may still leave the extension prompt open, but Katha
will discard its late result. A session API 401 clears authenticated state.

## Broadcast and confirmation

The existing [receipt endpoint](operation-receipts-api.md) first retains the verified
signed attempt as UNKNOWN. The browser broadcasts only after receipt retention
succeeds and the lifetime remains valid. This gives a known signature before any
uncertain send. The signature is shown as soon as signed; it does not imply broadcast
or success. Submission uses the exact signed bytes, preflight enabled and validator
`maxRetries: 0`. The controller makes one submission attempt and never resubmits.

A timeout or missing confirmation stays **Confirmation unknown**. **Check this
transaction again** only reconciles the same signed receipt; it never signs or sends.
Only the API's matching finalized successful receipt establishes finalization;
a matching finalized execution error establishes failure. A stale receipt cannot
regress a known finalized outcome. An expired preparation stops before broadcasting;
expiry of an unresolved signature does not prove it failed. Do not blindly prepare
or submit a replacement while the previous outcome is unresolved.

After successful registration finalization, a protected registration read checks for
the same finalized receipt signature and matching indexed Registry event, even for
unpublished works. Other operations use a public provenance read for the same signature.
Until observed, the panel reports **Transaction finalized; artwork indexing pending**.
An indexer/API outage never changes finalization into failure. The user can recheck;
no automatic polling or replacement transaction is scheduled. The first public
provenance page is checked (up to 100 events); an absent signature is an indexing
pending state, not proof of lost history. Conclusively finalized/failed work can be
replaced by a new review, while unresolved signed work cannot be overwritten.

Active transaction bytes stay in memory, separate from session tokens. Refresh,
provider disposal or identity changes clear that view. The API retains known signed
attempt receipts for operator reconciliation; this step does not add a browser
persistent recovery queue or an operation-history screen. If recording failed before
broadcast, Katha did not send; the local signature remains available for another
receipt check. If the browser closes after broadcast, reconcile retained receipts
before preparing another attempt. Feature-specific recovery screens follow separately.

## Verification

```bash
pnpm --filter @katha/web test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:public-journeys
pnpm format:check
pnpm install --frozen-lockfile
```

Unit tests generate temporary Ed25519 identities in memory and validate actual
v0/v1 wire/signature bytes. They cover identity/message/program/version failures,
explicit approval, double-click protection, record-before-send ordering, rejection,
failed simulation, fee changes, expiry before/after signing, account changes during
async work, receipt mismatch, submission uncertainty, finalized failure and indexing
delay/recovery. Mock Kit RPC tests check genesis calls, exact simulation options,
fee estimation and single preflight submission. Real component renders test status
labels, safe escaping and available controls.

Browser regression tests retain wallet sign-in coverage and add real review-panel
markup at 320/768/1440 pixels for review, signing, unknown, expired, failed, finalized
pending-index and indexed states. These view fixtures test layout, focus and full-page
accessibility; they do not mount a transaction launcher or send a wallet transaction.
Controller tests separately exercise transitions. No real wallet approval, external
RPC broadcast or private key file is used. Real Devnet operation acceptance remains
manual once the corresponding administration workflow is connected.

RPC behavior follows official [simulation](https://solana.com/docs/rpc/http/simulatetransaction)
and [submission](https://solana.com/docs/rpc/http/sendtransaction) documentation.

The artwork authenticity workflow supplies the reviewed authorship digest to the
transaction inspector. Before simulation it checks the decoded verification digest,
artwork/config/verification PDAs, verifier address, system program and exact five
account roles. Protected verification receipts provide indexing feedback for
unpublished artworks, scoped to the finalized signature. No public provenance
request is needed for this protected workflow.

Condition inspection adds a reviewed private report context to instruction checking:
UUID/hash, grade/reason, inspector, time and version must match; minted instructions
also bind owner and custody revision plus Core/custody PDAs. The protected condition
review provides receipt/indexing feedback for unpublished artworks. See
[condition inspection administration](condition-inspection-web.md).
