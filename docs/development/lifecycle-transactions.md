# Artwork lifecycle transaction preparation

The Solana package prepares six Registry operations through generated clients:

| Builder                                  | Authority    | Result                                         |
| ---------------------------------------- | ------------ | ---------------------------------------------- |
| `buildInitializeCustodyTransaction`      | Custody      | Initial physical custody attestation           |
| `buildTransitionCustodyTransaction`      | Custody      | Exact next custody revision                    |
| `buildInitializeMetadataTransaction`     | Registration | Version 1 metadata commitment                  |
| `buildReviseUnmintedMetadataTransaction` | Registration | Next pre-mint metadata commitment              |
| `buildMintArtworkTransaction`            | Registration | Atomic Core creation and Registry binding      |
| `buildReviseMintedMetadataTransaction`   | Registration | Atomic Core URI and Registry commitment update |

All use the explicit [Registry transaction context](registration-transactions.md).
Caller-fetched snapshots must come from the configured cluster and include
existence information. Validate freshness when preparing an operation, simulate
before wallet approval, and reconcile successful finalized receipts afterward.
The builders neither fetch nor sign nor submit transactions. They return one
generated instruction, an unsigned Kit message, canonical addresses, required
signer addresses, and the resulting version/revision where relevant.

Configuration, artwork identity, collection, ownership, discriminators,
allocated account sizes, PDA seeds and bumps, and the configured operation role
are checked before composition. The configured authority pays instruction rent;
the transaction fee payer may be a different wallet. Existing verifier builders
reuse the same account validation with their verifier role.

## Physical custody

Supply `CustodyTransactionInput` with the permanent `kathaId`, a shared
`PhysicalCustodyTransition`, and an explicit nullable `collector` address.
Initialization accepts the two `UNKNOWN` transitions. Later transitions require
the current `custodyHeadAccount` and `expectedRevision` as a bigint. The builder
checks the current state, subject, canonical latest-transition pointer, and exact
u64 successor. A stale or overflowing revision rejects preparation.

Collector custody names a nonzero custodian distinct from the custody authority.
Katha receipt and dispatch actions require `collector: null`. Dispatch clears the
current subject; the program preserves historical transitions. A custody subject
is a physical custodian, not an assertion of Core ownership. Listing or purchasing
does not invoke these builders automatically.

```ts
const prepared = await buildTransitionCustodyTransaction(context, accounts, {
  kathaId: "KATHA-PAUBHA-000001",
  transition: {
    action: "DISPATCH_FROM_KATHA",
    from: "KATHA_HELD",
    to: "IN_TRANSIT",
  },
  collector: null,
  expectedRevision: 1n,
});
```

## Versioned metadata

`MetadataTransactionInput` includes permanent `kathaId`, `documentBytes`, and
`uri`. The bytes must encode a canonical JSON object using the shared serializer.
The builder checks UTF-8 and canonical byte equality, then hashes those exact
bytes with SHA-256. It returns `documentHash`; document content is not included
in the prepared transaction. Rich metadata schema validation, approved media,
private/public boundaries, storage, and URI-content verification belong to the
later content API. Canonical encoding alone does not validate artwork semantics.

The URI must be at most 200 ASCII bytes, begin with lowercase HTTP or HTTPS, have
a host, and contain no credentials or fragment. Local HTTP storage is supported.
The builder does not fetch the URI. Store the same approved bytes outside Git at
the intended location before requesting the operation.

Revisions require the current `metadataHeadAccount`, `currentRevisionAccount`,
and an integer `expectedVersion`. The builder checks their canonical addresses,
artwork, bumps, version, and hash linkage, then derives exactly the next u32
version. A relocation may preserve the document bytes and hash.

Pre-mint metadata operations reject bound Core assets. Post-mint revision also
requires the bound canonical asset and collection snapshots. It checks Core's
collection authority, permanent name, and current URI against the Registry
revision. One Registry instruction performs the Core update and immutable
revision/head update atomically; it does not compose separate writes that could
partially succeed.

## Minting

`ArtworkMintAccounts` supplies configuration, artwork, verification, metadata
head/current revision, condition head, initial condition report, custody head,
Core collection, and the missing asset snapshot. The builder requires:

- an unbound artwork and absent canonical Core asset PDA;
- authentication of the registered evidence commitment;
- a matching current metadata revision;
- a version-1 `INITIAL_VERIFICATION` condition report with empty pre-mint scopes;
- valid Katha-held or collector-held custody, with its named subject;
- the configured collection under the canonical Registry collection authority.

Transit custody is ineligible. Core creates the asset with the permanent Katha ID
as its name, committed URI, configured collection, and registration authority as
initial digital owner. The Registry binds it in the same transaction. Duplicate
minting or an intervening state change still fails through on-chain checks.
Artist attribution and physical custody remain separate from initial ownership.

## Unsigned simulation and errors

`simulateRegistryTransaction(rpc, prepared)` compiles the unsigned message and
calls RPC simulation with `sigVerify: false`, `replaceRecentBlockhash: false`,
and confirmed commitment. Use an RPC connected to `prepared.cluster`. It returns
the simulation response, including logs and consumed resources, without changing
the message, signing, or broadcasting. An expired blockhash must be refreshed
and the operation prepared again. Success is a preflight observation, not
authority approval or a finalized receipt. The later operation workflow applies
resource estimation and presents wallet signing/confirmation.

Lifecycle builders raise `RegistryLifecycleError` with code `INVALID_INPUT`;
simulation failures or RPC outages use `SIMULATION_FAILED`. The error preserves
its underlying cause for controlled diagnostics. API logging and response
redaction remain the API boundary's responsibility.

```ts
const prepared = await buildMintArtworkTransaction(context, accounts, kathaId);
const simulation = await simulateRegistryTransaction(rpc, prepared);
```

The variables are caller-provided configured snapshots and context. Simulation
can become stale before signing; the program revalidates accounts atomically.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm program:test
pnpm codegen:check
pnpm format:check
```

Unit tests cover custody movements, subjects and counters, canonical metadata,
role/account substitution, mint prerequisites, Core synchronization, unsigned
roles, and typed simulation errors. LiteSVM executes builder-prepared custody,
metadata, minting, and post-mint revision instructions alongside the existing
program authorization and rollback cases. Offline Surfpool verifies unsigned
simulation succeeds while the configuration account remains absent until actual
test submission. Automated signing uses temporary synthetic identities only.

See the official [Solana simulation RPC](https://solana.com/docs/rpc/http/simulatetransaction)
and [Kit wire encoding](https://www.solanakit.com/api/functions/getBase64EncodedWireTransaction).

[Custody and manual fulfillment API](custody-operations-api.md) prepares unsigned
custody attestations and exposes private owner requests/admin coordination. Manual
request status never creates finalized custody or transfers Core ownership.

[Artwork mint preparation](artwork-minting-api.md) exposes the protected atomic mint
builder with exact document/chain eligibility checks and one reserved idempotent
intent per artwork/cluster. Preparing an unsigned transaction does not publish or mint.

[Metadata commitment preparation](metadata-revisions-api.md) exposes authorized
unsigned initial, pre-mint and atomic post-mint metadata transactions with exact
stored-byte validation, reviewed version/hash checks and save-time eligibility guards.
