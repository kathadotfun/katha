# Metadata revision administration

Open `/admin/artworks/:kathaId/metadata` from the minting screen. Sign in with an
administrator wallet on the configured localnet or Devnet cluster. The configured
registration authority prepares and signs the on-chain change.

1. Reload saved state. Review the permanent artwork and artist identities, current
   on-chain version, current URI/hash, and both exact public JSON documents.
2. Edit the story, meaning, cultural context or creation process. All other fields
   are copied from the approved document. Confirm the text is approved for public
   storage; saving appends an immutable local version without publishing a chain
   revision. Anyone who knows its content address can read an approved public document.
3. Compare current and proposed text and hashes. Save outstanding edits before
   confirming the saved revision. Prepare the unsigned transaction.
4. Review simulation, accounts and fees. Approve signing separately in your wallet.
   A minted artwork uses one Registry instruction that updates the Core URI and
   Registry commitment atomically. Unminted records use the existing initialization
   or revision instruction. Authorship, digital ownership and custody are preserved.
5. Check the retained signature and reload after finalized reconciliation/indexing.
   An unknown outcome blocks edits and preparation. Recheck that signature before
   retrying. Earlier documents remain available; a failed transaction does not advance
   the Registry/Core state or finalized public content.

Private responses use authenticated `no-store` calls. Session expiry, wallet switching,
logout and permission revocation clear the review. The browser verifies canonical
bytes/hash, immutable fields, head/revision/asset PDAs, instruction mode, versions,
URI, exact account roles and configured collection before simulation or wallet signing.
No signing happens on page load, document save or preparation.

The append transaction locks the artwork before loading its latest metadata, rejects
stale timestamp/document IDs and unresolved signed attempts, persists/read-checks
exact bytes, then increments the local version and artwork timestamp. Competing edits
cannot overwrite each other. The latest finalized document supplies public story
fields; prepared versions do not change the public artwork response. Finalized receipt status
is scoped to the proposed document ID; unresolved receipts remain visible across revisions. The old hash appearing in a later operation
cannot make it appear submitted again.

Use `pnpm test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm format:check`, `pnpm codegen:check`, and
`pnpm --filter @katha/web test:public-journeys`. Tests use synthetic documents,
RPC responses and wallets. A real wallet submission and Devnet deployment remain
manual operations.

Core URI changes require the configured update authority. Katha exercises that
capability through its Registry CPI. See [Core update documentation](https://www.metaplex.com/docs/smart-contracts/core/update).
The live reader validates mutable accounts from a finalized
[getMultipleAccounts snapshot](https://solana.com/docs/rpc/http/getmultipleaccounts)
and separately checks the immutable current revision.
