# Artwork registration administration

Open **Register artwork on chain** from a saved artwork's documentation page.
`/admin/artworks/:kathaId/registration` requires an administrator wallet session.
The API independently checks the configured admin role and fresh finalized Registry
registration authority before preparing the unsigned transaction. A verifier-only
wallet cannot use this administration workflow.

## Prepare and review

Finish the artist's manual profile verification and artwork documentation first.
Supply a nonzero authorship evidence digest. Finish media approval, including one
public HERO image, dimensions, materials, technique and all cultural descriptions
required by the canonical metadata schema. Creator-wallet attribution may remain
absent; payout-wallet configuration is not part of registration.

**Prepare canonical metadata** calls the admin public-document endpoint and reloads
its saved version. Preparing this document publishes its exact JSON bytes and
closes draft/media editing under the existing conservative lifecycle rules. Review
and approve source content and media before this action. Private photographs,
inspection reports, contacts and shipping information must remain outside the
public document. Canonical documents and uploads remain outside Git.

The screen displays permanent identity, immutable artist UUID/creator wallet,
category, creation year and evidence hash. It verifies the canonical serialization,
SHA-256 and document attribution again in the browser, then offers the exact saved
JSON for review. It never fetches an arbitrary document URL supplied by a visitor.
A saved document with mismatched bytes, hash, title or attribution is unusable.

Check the document-review confirmation, then choose **Prepare and simulate
registration**. The browser sends the current timestamp, selected metadata UUID and
actual connected-wallet transaction-version capabilities. The idempotency key is
stable for this session's wallet record and metadata UUID, including after a refresh.
Localnet requires v0; Devnet supports v1 or v0 according to wallet capabilities.

The generated instruction is decoded and compared with the independently reviewed
artist, creator wallet, category, year and evidence commitment. Simulation and the
shared transaction review then show the test network, authority/fee payer, fee,
account privileges and message hash. **Approve in wallet and submit** is the only
signing trigger. The page and persistent wallet panel share one transaction controller;
their approval buttons cannot cause duplicate submission.

Registration creates the immutable Registry identity and authorship commitment.
It does not authenticate, inspect, mint, publish the artwork, sell it or change
physical custody. The reviewed metadata version is bound to the retained off-chain
operation; its hash/URI are not written by the registration instruction. On-chain
metadata initialization/revisions belong to later lifecycle workflows.

## Receipt and indexing state

The controller retains the verified signed attempt before a single broadcast and
reconciles its exact finalized receipt. An unsigned preparation, signed message or
simulation is not registration success. A timeout stays unknown; recheck the same
signature instead of creating a replacement. See [wallet transaction lifecycle](transaction-lifecycle-web.md).

The protected registration read also displays retained receipt status, signature,
slot and whether its Registry event was indexed. This works for unpublished
artworks, whose public provenance route remains unavailable. **Registration event
indexed** means this matching event was observed; it does not assert that the entire
artwork history has no indexing gaps. Indexer failure never turns a successful
finalized receipt into a failed transaction.

Use **Reload registration state** to inspect saved outcomes. Older unresolved signed
attempts cannot be hidden by newer unsigned preparations. Such an outcome blocks
fresh preparation, including after refresh. While the original signed bytes remain
in the transaction controller, **Check this transaction again** reconciles that
attempt without signing or sending. Refresh/account changes discard in-memory
transaction bytes. If they are lost, the saved receipt still shows its signature;
an operator must reconcile the retained attempt using the existing receipt workflow
before requesting another registration. No browser persistent recovery queue or
operation-history interface is added here.

Failures or uncertain preparations pause the workflow until reload. A reload checks
permissions and exact saved bytes again; it never retries a write automatically.
Account/session changes clear private review state and discard late preparations.
Published or already registered works, missing attribution, an unverified artist,
unsupported capabilities, changed documents and unresolved receipts cannot initiate
another registration through the page.

## Protected contracts

- `GET /admin/artworks/:kathaId/registration` returns the explicitly projected
  identity, timestamp, artist-verification hint, canonical public metadata and
  receipt/indexing status. Private biographies, payout wallets, storage paths,
  signed/unsigned transaction bytes and internal operation intent are excluded.
- `POST /admin/artworks/:kathaId/documents/metadata` accepts
  `{ expectedUpdatedAt }` and returns the existing prepared-document summary.
  It grants administrators public metadata preparation only. Condition preparation
  retains its verifier-only route.
- `POST /admin/artworks/:kathaId/operations/registration` uses the existing
  [strict preparation contract](artwork-registration-api.md).

All admin responses are no-store. Read eligibility and saved receipt state are
snapshots, not a substitute for write-time checks or receipt reconciliation.

## Verification

Run `pnpm --filter @katha/web test`, `pnpm --filter @katha/api test`,
`pnpm --filter @katha/shared test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm --filter @katha/web test:public-journeys`, `pnpm format:check`
and `pnpm codegen:check`.

Synthetic tests cover immutable instruction mismatches, tampered documents,
authorization, explicit review, session cancellation, metadata version binding,
uncertain writes, one broadcast, finalized receipt/indexing separation and hidden
older attempts. Chromium checks the connected launcher, metadata review, conflict,
simulation before approval, unresolved receipts and finalized/indexed states at
320, 768 and 1,440 pixels. Browser RPC is mocked and no real transaction is signed
or sent. Real Localnet/Devnet wallet approval remains manual.

RPC behavior follows official [simulation](https://solana.com/docs/rpc/http/simulatetransaction)
and [submission](https://solana.com/docs/rpc/http/sendtransaction) contracts.
