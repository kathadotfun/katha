# Devnet payment provider

`apps/api/src/payment.ts` defines the internal `PaymentProvider` boundary and its
Devnet test-token adapter. It prepares and verifies the one Marketplace purchase
transaction; it never signs, submits, sends a separate token transfer, approves
physical delivery or marks an artwork verified. Localnet is supported for tests.
Mainnet and production/fiat settlement are excluded.

## Composition

Construct the Solana `createMarketplacePaymentSettlement` with:

- `createOperationChain` for the configured Localnet/Devnet RPC;
- `createOperationReceiptReader` using that same cluster;
- the explicitly configured six-decimal test payment mint.

Pass the settlement adapter and wallet-session authentication boundary to
`createDevnetPaymentProvider`. Its description labels `DEVNET_TEST_TOKEN`, the
cluster, mint, six decimals and simulation status. No new environment variable or
startup wiring is required yet: listing/purchase HTTP integration follows separately.

## Preparation

The server supplies `PaymentArtworkState`: encoded Marketplace/Registry/Core
snapshots and a chain timestamp. These are trusted reader inputs, not HTTP request
fields. The purchase input uses a permanent Katha ID, exact listing revision and
integer-decimal price in token base units. The authenticated wallet supplies the
buyer and fee payer, and the adapter supplies the configured payment mint.

The generated-client purchase builder validates current owner, listing identity,
configuration, payout binding and the reviewed quote. The adapter uses the existing
transaction context and simulation boundary, then checks the simulated artifact
against its independently encoded unsigned message: bytes, hash, version, buyer
signer, fee payer, blockhash and validity height must agree. The response contains
an unsigned artifact and the authenticated wallet record ID.

Simulation still performs on-chain checks for funds, token accounts, inspection
eligibility and delegates. It is not proof a later transaction will succeed. Only
one Marketplace instruction is prepared. Payment splitting and Core transfer
remain atomic inside that program, using its configured fees; this adapter does
not calculate a second settlement or choose production economics.

## Verification

Keep `AuthenticatedPaymentPreparation` in trusted server persistence. Reload it
for the same wallet record when verifying; never accept a browser-supplied
preparation as authority. The boundary authenticates the session again and binds
its wallet and cluster. It then checks canonical wire encoding, unsigned original
bytes, message hash, exact signed message, genuine buyer signature, supported
version, fee payer and a single Marketplace purchase instruction. Decoded buyer,
mint, artwork PDA, expected price and revision must match the preparation.

The receipt reader checks RPC genesis and reads the exact signed transaction at
finalized commitment, with transaction-version support. Its byte/version/signature
binding prevents substituting another transaction. A successful finalized purchase
is the settlement evidence; current account ownership may later change through
another sale. Missing data or an RPC outage returns `UNKNOWN`; a matched finalized
transaction error returns `FAILED`; mismatched signatures/messages/networks reject.
Only `FINALIZED` returns its slot and timestamp, as JSON-safe strings. Unknown or
failed observations do not mean payment completed and do not mutate ownership.

The official [Solana transaction RPC documentation](https://solana.com/docs/rpc/http/gettransaction)
describes commitment, version support and missing transaction responses.
Marketplace event indexing and public sale history remain separate integration work.
The HTTP receipt allowlist also accepts listing creation/cancellation; purchase
receipt integration remains separate. See the [listing API](artwork-listings-api.md).

## Checks

```bash
pnpm --filter @katha/solana exec vitest run tests/marketplace-payment.test.ts
pnpm --filter @katha/api exec vitest run tests/payment.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

Temporary synthetic signatures test v0/v1, forged signatures, altered messages and
quotes, cross-wallet/network requests, simulation mismatch, receipt outages and
actual finalized RPC decoding with failed/substituted transactions. API tests
cover session authorization, safe error mapping and receipt projections. No real
wallet keys or Devnet transaction is needed. See [marketplace builders](marketplace-transactions.md)
and [local primary purchase](marketplace-primary-sale.md) for settlement behavior.
