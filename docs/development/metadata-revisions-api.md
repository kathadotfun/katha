# Metadata commitment preparation

`POST /admin/artworks/:kathaId/operations/metadata` prepares an unsigned Registry
metadata commitment. It requires an authenticated session on the server cluster,
admin allowlist membership and current finalized registration authority. Unknown
body fields and query parameters fail. Success is 201 with
`unsignedOperationResponseSchema` and `Cache-Control: no-store`.

```json
{
  "idempotencyKey": "synthetic-metadata-revision-2",
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "metadataVersionId": "11111111-1111-4111-8111-111111111111",
  "expectedMetadataVersion": 1,
  "expectedMetadataHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "supportedTransactionVersions": [0]
}
```

`metadataRevisionRequestSchema` separates the selected local document UUID from
its reviewed current chain version/hash. The next chain version is derived as
current version + 1. Versions cannot advance beyond u32. For the first commitment,
set `expectedMetadataVersion` to 0 and `expectedMetadataHash` to null. This pair
is accepted only when the chain metadata head and deterministic asset are absent
and the artwork has no Core binding. Clients cannot provide the URI, new hash,
asset, owner, artist, instructions or arbitrary transaction bytes.

## Exact documents and attribution

The API authorizes before reading private database rows. It loads the artwork,
artist and latest local metadata under shared row locks. Only the latest PREPARED
document is eligible; DRAFT and FINALIZED rows cannot serve as new proposed versions.
It requires the reviewed artwork timestamp and continued artist approval. Publication
is permitted; metadata updates never themselves publish or unpublish an artwork.

Canonical document syntax, exact SHA-256 bytes, permanent Katha ID, category,
artist identity, optional creator wallet, creation year and current documented title
must match. `StorageProvider` PUBLIC bytes must equal those bytes. The API reads its
own content-addressed provider reference and does not fetch an arbitrary supplied URI.
Registered artist attribution, creator wallet, year and authorship evidence hash must
also match the immutable local record. Replacement artist identities and tampered
stored/provider documents fail before operation persistence.

## Finalized state and instruction selection

The Kit reader resolves collection configuration, then obtains configuration,
artwork, metadata head, collection and canonical Core asset together using finalized
[getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts). It rejects
changed collection configuration, missing records, a noncanonical binding, an occupied
unbound asset or missing minted prerequisites. The immutable current metadata revision
is fetched separately. The existing builders enforce Registry account ownership,
allocated size, discriminator, PDA relationships, head hash and revision linkage.

| Finalized state            | Prepared instruction       | Behavior                                                        |
| -------------------------- | -------------------------- | --------------------------------------------------------------- |
| Unminted, no metadata head | `initialize_metadata`      | Create head and immutable version 1 together.                   |
| Unminted, existing head    | `revise_unminted_metadata` | Preserve earlier revisions and advance the commitment.          |
| Bound canonical Core asset | `revise_minted_metadata`   | Atomically advance the Registry commitment and update Core URI. |

Existing revisions require the exact reviewed current version and hash. Identical
current/new URI and hash are rejected as a no-op. URI relocation with unchanged bytes
is permitted as a new version. After minting, the builder also checks the canonical
collection authority, Core program/account owner, bound asset, permanent Katha ID name
and current Core URI against the current Registry revision. An out-of-sync URI or
wrong collection fails. One generated instruction performs the update; no separate
Core transaction or partial synchronization is prepared.

## Retries, signing and finalization

The existing operation store retains one immutable intent for a wallet/cluster/key,
including selected document, current version/hash/URI, chosen instruction, account
roles and new exact hash/URI. Identical retries retain the operation and may refresh
blockhash/version transport; incompatible intent requires a new key. Save-time locks
recheck the latest document UUID/bytes/hash/URI, artwork timestamp/publication state,
immutable attribution and artist approval. A raced change writes no preparation.

Different keys can prepare competing revisions. Preparation does not reserve chain
state. The Registry expected-version check permits only one advancing revision to
execute; a stale competing transaction fails atomically. Initialization similarly
fails if the head already exists. Post-mint Core failure rolls back the entire Registry
revision. Earlier immutable versions, authorship, Core owner, verification and custody
remain preserved. Wallets should refresh preparation after a state change and review
simulation before signing.

The configured registration wallet signs and pays rent. Preparation signs/submits
nothing, does not mark the local document FINALIZED, changes no public metadata
projection, and records no successful provenance or ownership. Receipt validation
and indexed publication remain separate workflows. Localnet uses v0; Devnet uses v1
when supported, falling back to v0 through the existing transaction boundary.

Invalid requests return 400; missing/unauthorized sessions 401/403; missing local
artworks 404; integrity, stale state, account, simulation or save conflicts 409.
Infrastructure errors are redacted. No private report notes, evidence, shipping
information or RPC details enter the response.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm program:test`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm format:check` and `pnpm codegen:check`. Synthetic API tests cover
all three real generated instruction paths, immutable attribution and storage failure,
Core inconsistency, authorization and unchanged local state. PostgreSQL verifies stale
snapshot rollback and same-key operation reuse. Reader tests cover finalized snapshots
and missing/forged prerequisites. API RPC/simulation is mocked; the existing offline
Registry/Core harness separately exercises actual pre/post-mint revision, stale writes
and atomic rollback. No live signing or Devnet deployment is claimed.
