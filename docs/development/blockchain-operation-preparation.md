# Unsigned blockchain operation preparation

`createBlockchainOperations` in `apps/api/src/blockchain-operations.ts` is an
internal service boundary. It composes the PostgreSQL preparation store, existing
wallet/Registry authorization and the Kit-only operation chain adapter. The helper itself installs
no generic HTTP route. [Registration](artwork-registration-api.md) is its first feature
handler, supplying validated domain inputs and
trusted generated-client builder; raw client instructions, RPC URLs and program
addresses are not accepted through a generic endpoint.

## Preparation flow

1. Validate `operationIntentSchema`: artwork UUID, permanent Katha ID, Registry
   operation kind, wallet-scoped idempotency key, expected accounts/hashes and
   already validated JSON domain parameters. Marketplace kinds are excluded.
2. Authenticate the session and recheck the configured role and fresh finalized
   Registry authority. Every retry repeats authorization; session cluster must
   match configured localnet/Devnet. Registration, minting and metadata revisions
   use registrationAuthority; verification/condition use verifierAuthority;
   custody uses custodyAuthority. Admin and verifier allowlists remain independent.
3. Fetch a confirmed recent blockhash and height. The authenticated wallet is both
   fee payer and authority. Use v0 on the pinned localnet runtime; Devnet selects
   v1 when supported by the wallet, otherwise v0. Legacy-only wallets are rejected.
4. Call the trusted builder and check cluster, payer, version, exact lifetime,
   a single Registry instruction and the complete expected account set. The account
   set includes the Registry program and fee payer as well as instruction accounts.
5. Canonically serialize the intent with server-selected wallet/cluster/program,
   ordered instruction accounts/roles and exact instruction bytes. Hash exact UTF-8
   bytes. Account/hash expectation sets are sorted; domain arrays retain order.
   Canonical requests are bounded to64 KiB and kept private.
6. Compile unsigned bytes using Kit, check transaction size, hash the compiled
   message and simulate the exact wire bytes with confirmed commitment,
   `sigVerify:false` and `replaceRecentBlockhash:false`. RPC calls have10-second
   deadlines. Recheck height after simulation; reject an expired lifetime. No
   signing, broadcast, blockhash replacement or key access occurs.
7. Require exactly one compiled signer: the authenticated fee payer. Validate the
   shared response projection before persisting the operation/preparation together.
   The store also checks wallet identity and artwork UUID/permanent-ID binding.

Simulation is a prediction against current chain state, without signature checking.
It is not wallet authorization, finality or a guarantee that a later signed
transaction succeeds. The signing wallet must approve the transaction and submit
it. See the official [simulateTransaction contract](https://solana.com/docs/rpc/http/simulatetransaction).

## Intent, retries and message history

Existing `blockchain_operations` holds the wallet/cluster/key identity, operation
kind, artwork, program and expected account/document commitments. Migration0010
adds `operation_preparations` with private canonical intent, unsigned base64 bytes,
message hash, transaction version, blockhash/expiry and simulation slot/units.
Existing operation/receipt history is preserved.

Wallet row locking serializes concurrent retries even when the operation row does
not yet exist. A matching key reuses its operation; the same compiled message
reuses its preparation ID. Simulation runs again on every request and the response
contains that fresh summary; the retained row preserves its original observation.
A refreshed blockhash produces another immutable preparation for the same intent.
Earlier messages remain available for later receipt validation. Changed domain
parameters, instruction data/roles, artwork, kind or commitments conflict. Once
receipts move an operation away from PREPARED, this helper refuses further
preparation; later reconciliation/recovery workflows must handle that state.

The migration enforces permanent preparation rows and ties their canonical intent
hash to the parent operation. Preparation/message uniqueness, format/size bounds,
foreign keys, nonnegative numeric fields and atomic rollback are enforced. Only
successful simulation reaches persistence. A failed insert rolls back a newly
created operation as well. Preparation creates no receipt, finalized attestation,
ownership, custody or sale record. RPC work finishes before the database save;
feature handlers must validate their current domain snapshots and chain accounts,
and eventual chain execution remains authoritative.

## Response and errors

`unsignedOperationResponseSchema` contains operation/preparation IDs, permanent ID,
kind, cluster, PREPARED status, request/message hashes, unsigned transactionBase64,
transactionVersion, fee payer, requiredSignerAddresses, blockhash,
lastValidBlockHeight and `simulation: { slot, unitsConsumed }`. Heights, slots and
units are canonical integer decimal strings; unavailable units are null. Canonical
requests, private evidence, RPC logs, return data and raw RPC errors are omitted.
This is a protected operation response, not a public artwork response.

Malformed input or unsupported wallet versions return INVALID_REQUEST through the
existing error boundary. Invalid roles return UNAUTHENTICATED/FORBIDDEN. Lifecycle,
account/payer/lifetime mismatches, failed execution simulation and conflicting
idempotency keys use CONFLICT. Missing artwork binding uses NOT_FOUND. Unavailable
or malformed RPC responses remain redacted INTERNAL_ERROR. Existing HTTP routes
and the [content API inventory](content-api-contracts.md) are unchanged.

## Verification

```bash
pnpm test
pnpm db:test
pnpm typecheck
pnpm lint
pnpm build
pnpm format:check
pnpm codegen:check
```

Synthetic shared/API/Kit cases exercise strict contracts, role changes on retries,
wrong clusters and message alterations, exact unsigned bytes, safe projections,
RPC failures and blockhash expiry. Disposable PostgreSQL cases exercise concurrent
retries, immutable refreshed messages, conflicting intents, identity bindings,
rollback and receipt-state guards. Tests use temporary/synthetic identities, no
real signing material or artwork evidence. No dependency or program change is
needed; registration HTTP preparation now uses this boundary.

[Artwork verification preparation](artwork-verification-api.md) exposes the verifier
operation route, binds manual confirmation and documented attribution, and rechecks
eligibility during locked persistence. It does not finalize authentication.

[Condition attestation preparation](condition-attestation-api.md) selects initial,
unminted or minted condition instructions. Minted follow-up reports bind the current
Core owner and held custody revision in their hashed private document; execution
rechecks scope. Preparation does not finalize inspection state or approve resale.

[Custody and manual fulfillment API](custody-operations-api.md) prepares unsigned
custody attestations and exposes private owner requests/admin coordination. Manual
request status never creates finalized custody or transfers Core ownership.

[Artwork mint preparation](artwork-minting-api.md) exposes the protected atomic mint
builder with exact document/chain eligibility checks and one reserved idempotent
intent per artwork/cluster. Preparing an unsigned transaction does not publish or mint.

[Metadata commitment preparation](metadata-revisions-api.md) exposes authorized
unsigned initial, pre-mint and atomic post-mint metadata transactions with exact
stored-byte validation, reviewed version/hash checks and save-time eligibility guards.
