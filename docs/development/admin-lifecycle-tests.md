# Authorized artwork onboarding integration

Run from the repository root:

```bash
pnpm admin:test
```

The command builds the API and shared packages, creates a disposable PostgreSQL
18.6 container on a random loopback port, applies every migration, builds the
Registry with the existing test harness, and starts offline Surfpool. It loads the
hash-pinned Core binary and runs the production API and one-shot indexer against
that isolated network. Docker must be running; the PostgreSQL image, pinned SBF
build tools, Surfpool, and cached Core fixture must be available as described in
[local program testing](program-testing.md). If the Core fixture is absent, the
existing program runner downloads it from Devnet and verifies its pinned hash.

The test uses fresh in-memory signing identities and synthetic artwork/media.
It does not load `.env`, a wallet keypair, or developer database/storage contents.
The owned container, API, Surfpool, and temporary storage are removed on completion
or failure. The first available local block is the indexing start boundary; a
nonexistent earlier block is correctly treated as a history gap.

Surfpool 1.6 labels signature-discovery entries `confirmed` even for a finalized
query. A loopback-only test bridge retains each original signature, slot, error and
timestamp, excludes entries above Surfpool's finalized slot, and sets the discovery
label accordingly. All other RPC responses pass through unchanged; transaction
bytes, logs, account checks, and production decoding are retained. Separate tests
verify that future entries are excluded, missing finality evidence fails closed,
and signed bytes pass through unchanged. This is a local simulator compatibility
measure, not evidence of Devnet finality or a change to production authorization.

## Covered journey

1. Sign in separate administrator, verifier, and outsider identities; reject
   replayed sign-in challenges.
2. Create and manually approve an artist without a creator wallet.
3. Create a permanent artwork identity, edit its story, and reject stale edits.
4. Upload an explicitly approved public photograph and prepare canonical metadata.
5. Prepare, sign, submit, reconcile, and index actual Registry registration.
6. Attest authenticity using the verifier; upload private inspection evidence and
   anchor the initial condition report.
7. Attest Katha physical custody independently of ownership.
8. Initialize the metadata commitment, mint the deterministic Core asset, wait for
   finalized indexing, and explicitly publish the artwork.
9. Prepare a story revision, confirm that pending content leaves the public story
   unchanged, and atomically update Core URI and Registry commitment.
10. Verify stable attribution, ownership, custody, earlier document bytes, and
    idempotent receipt/indexer replay; revoke the administrator session.

For each chain operation the test signs the API's exact unsigned message, verifies
its message hash and required signer, sends it to local Surfpool, reconciles its
finalized receipt through the API, then runs the actual indexer. Setup cheatcodes
only assign synthetic SOL balances and a bootstrap upgrade authority. Artwork
lifecycle accounts and indexed events are created by real program instructions.
Mint status and publication require the Registry's indexed `ArtworkMinted`
ownership event, matched to its finalized receipt, cluster, artwork, asset, and
program. A generic Registry event or a Core transfer cannot substitute for that
mint evidence. The database regression checks these rejected cases explicitly.

Finalized Registry events also reconcile the public read model in the same
transaction as the indexed events and checkpoint. Verification preserves the
registered authorship hash. Prepared metadata and condition documents are promoted
only when their hashes, wallets, and report fields match the signed evidence;
metadata additionally requires the URI decoded from the actual instruction.
Missing documents remain unpublished. Replay can reconcile a later available
prepared document without duplicating evidence. Mismatches roll back the entire
batch. Existing finalized versions remain immutable. Public custody uses the
latest indexed signed manual attestation, with the earlier manual-record fallback.

Wrong-role calls, premature publication, stale document saves, and private evidence
retrieval through the public storage route must fail.

## Related checks and limits

```bash
pnpm test
pnpm db:test
pnpm program:test
pnpm --filter @katha/web test:public-journeys
```

`packages/solana/tests/tsconfig.json` makes the existing Node-enabled test
configuration discoverable by editors for test files and nested fixtures. Node
typings are already pinned in the Solana package; no additional installation is
needed.

`pnpm test` excludes the local-stack integration, which needs Docker and Surfpool.
`pnpm db:test` covers database constraints and API persistence; `pnpm program:test`
adds program authorization, forged-account and rollback cases. The browser suite
covers administration forms, session changes, signing prompts, and accessibility
with synthetic wallet/API responses. This integration uses HTTP and temporary test
signers; real browser-extension approval, physical inspection and movement, NFC
writing, and Devnet deployment remain manual. The later collecting end-to-end
steps add primary purchase and resale.

Transaction construction follows the installed Kit API and its
[official transaction guide](https://www.solanakit.com/docs/advanced-guides/transactions).
No test identity, database credential, inspection report, or generated test output
needs to be published.
