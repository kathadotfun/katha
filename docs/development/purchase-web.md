# Buyer purchase signing and confirmation

From `/art/{kathaId}`, select **Review purchase quote**, connect and sign in with
the buyer wallet, then **Refresh purchase quote**. The quote displays the exact
six-decimal test-token payment, role amounts, merged recipient wallets, expected
listing revision and independently recorded custody.

Select **Prepare reviewed purchase**. This authenticates the buyer and posts only
the reviewed quote hash, wallet-supported transaction versions and a generated
idempotency key to the existing [purchase API](artwork-purchases-api.md). The API
rereads finalized eligibility and rejects stale terms before preparing a purchase.
Preparation does not request a wallet signature. A stale/ineligible preparation
clears the quote; refresh current terms before trying again.

## Transaction review and approval

The shared transaction flow checks the unsigned wire, sole buyer signer, cluster,
version, blockhash/message commitment, exact generated Marketplace instruction,
permanent artwork/Core/listing PDAs, Registry accounts, condition report, reviewed
collection, payment mint and canonical SPL token accounts. Price/revision, canonical
semantic quote hash and exact checked distributions must match the reviewed terms.
Extra instructions, changed recipients, mint, token accounts or terms fail closed.

The transaction review shows exact token base units, merged recipient wallets,
mint, listing revision, fee payer, network and estimated SOL fee. Test tokens have
no monetary value; network fees are additional. Select **Approve in wallet and
submit** only after reviewing these terms. The client simulates again and requests
a signature through the existing Wallet Standard adapter. A changed fee requires
another review. Returned signed bytes must preserve the exact prepared message and
contain the genuine buyer signature. The API retains the signed attempt before
broadcast, then verifies finalized receipts against its persisted operation intent.

Wallet rejection and preflight failure never report a completed purchase. Listing,
condition, custody or funding can change after simulation; settlement rechecks
eligibility atomically when the transaction executes. A finalized failure does not
complete this operation. Physical custody and artist authorship stay separate.

## Three independent observations

1. **Receipt finalized:** the exact successful purchase transaction is finalized.
2. **Core ownership confirmed:** a network-bound finalized RPC account read at or
   after the receipt slot validates the Core program, asset data and collection,
   then checks the buyer as current owner. Missing, malformed, stale-slot or
   mismatched accounts leave this check pending.
3. **Transfer history indexed:** the public provenance read contains the same
   signature, artwork/asset/collection and transfer destination. Indexer outages or
   catch-up delays do not turn a finalized purchase into a failure.

Use **Check this transaction again** for pending ownership/indexing or unknown
confirmation. The same signed attempt is reconciled; it is not broadcast again.
An unknown signature blocks another preparation. Refresh/replacement is also blocked
once purchase success is awaiting ownership or indexer checks. A fresh read after
cancellation/rejection is required before a new review. No quote reserves an artwork.
If the asset has subsequently moved to another owner, current Core ownership will
not match the buyer; the UI retains pending observation rather than asserting present
ownership. The finalized receipt remains historical purchase evidence.

Session changes, disconnect, revocation and disposal abort preparation and discard
late results. Signature/recovery state is kept only in the browser runtime; after a
reload or lost session the operator must use the retained operation/receipt and
signature before attempting a replacement. This screen does not provide a cross-
reload recovery dashboard. Shipping/receipt coordination is a separate manual flow.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @katha/web test:collection
pnpm format:check
pnpm codegen:check
```

Synthetic tests cover reviewed substitutions, exact wire signing through the real
wallet adapter, transport privacy, stale preparation, unknown/no-replacement,
rejected approvals, finalized failure, Core account program/collection/data/slot/
owner checks and matching indexed transfers. Browser checks exercise stale quote,
review/recipient/payment display and wallet rejection at 375/768/1280px, including
accessibility and overflow. No real wallet approves or pays during automated tests.

A funded buyer and eligible listing on configured localnet/Devnet are prerequisites
for manual acceptance. The operator verifies the same finalized signature, Core
owner and transfer history, then checks that custody and authorship remain accurate.
The RPC observation uses official [getAccountInfo](https://solana.com/docs/rpc/http/getaccountinfo)
commitment/context rules and the existing Core adapter; Metaplex describes
[Core ownership transfers](https://www.metaplex.com/docs/smart-contracts/core/transfer).
