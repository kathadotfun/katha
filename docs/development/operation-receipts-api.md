# Finalized operation receipts

`POST /operations/:operationId/receipts` records and reconciles a signed Registry
operation attempt. An authenticated session may access only its own operation and
preparation on the configured cluster. Previous registration/verifier/custody roles
are not rechecked: a historic transaction can remain valid after authority rotation.
The original preparation and signed transaction bind the authorized signer.

The UUID path uses `operationReceiptParamsSchema`. Query parameters and unknown
body fields are rejected. `operationReceiptRequestSchema` accepts only:

```json
{
  "preparationId": "11111111-1111-4111-8111-111111111111",
  "transactionBase64": "AAAA"
}
```

`AAAA` is a schema illustration, not a valid signed transaction. Replace it with the
wallet-signed copy of the selected preparation. Wallets must preserve the exact message;
changing a blockhash, transaction version, compute budget, account, instruction or fee
payer requires a new server preparation. The endpoint neither signs nor broadcasts.
Clients cannot supply a signature, status, slot, cluster, failure code or chain timestamp.

## Binding the signed attempt

Before creating a receipt, the SDK:

- decodes canonical, size-bounded wire bytes with Kit and rejects trailing bytes;
- requires the preparation to be unsigned and the submitted transaction to have exactly
  one signature from the operation's session wallet;
- cryptographically verifies Ed25519 over the exact message bytes;
- compares every message byte and SHA-256 against the stored preparation;
- validates canonical request bytes/hash, wallet/cluster/artwork/key, operation kind,
  expected program, account set and commitment hash list against immutable operation rows;
- decompiles the message and checks fee payer, one Registry instruction, the generated
  discriminator allowed for the operation kind, ordered accounts, normalized compiled
  account privileges and exact instruction data against canonical preparation intent.

The preparation hash binds the expected commitment list, including commitments that
were checked during preparation but do not occur directly in the instruction. Exact
instruction data binds hashes encoded on chain. This is not a new off-chain document
inspection or a claim that arbitrary document bytes were retrieved from the chain.
Lookup-table or extra-instruction messages are unsupported by these preparations.
Localnet accepts prepared v0; Devnet accepts prepared v0/v1. No generated clients or
program instructions change.

Only then is the signed attempt stored as UNKNOWN. Its signature is derived from
verified wire bytes. A signed attempt does not prove that the wallet submitted it.
This durable entry survives an unavailable RPC and supports retrying the same POST
with the original signed wire/preparation. No worker, broadcast or expiry inference
is introduced by this endpoint.

## Finalized RPC evidence

The reader uses the server's configured RPC. It checks `getGenesisHash`: Devnet must
match the [known cluster genesis](https://github.com/solana-labs/solana/blob/master/sdk/src/genesis_config.rs);
localnet rejects known public network genesis hashes. A mismatch fails closed rather
than attaching a successful transaction from another cluster. The RPC remains a trusted
chain-data provider; these checks do not create a cryptographic proof of finality.

[getTransaction](https://solana.com/docs/rpc/http/gettransaction) is requested with
`commitment: finalized`, `encoding: base64` and `maxSupportedTransactionVersion: 1`.
The returned full signed wire, signature, message bytes and version must exactly match
the verified attempt. No logs, client assertions or matching current account state
substitute for this evidence.

| Evidence                                                                                                  | Receipt outcome                                                     |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Missing finalized transaction, unavailable RPC, incomplete metadata/timestamp or invalid numeric evidence | UNKNOWN; no expiry assumption.                                      |
| Matched finalized transaction with a valid non-null execution error                                       | FAILED with `TRANSACTION_FAILED`; raw error/logs omitted.           |
| Matched finalized successful transaction with valid slot and finite nonfuture block time                  | FINALIZED, retaining exact integer slot and chain time.             |
| Wrong genesis, signature, wire, message or version                                                        | 409 conflict; a previously verified signed attempt remains UNKNOWN. |

A transaction missing at finalized commitment may be pending, unavailable in RPC
history, on another network, never submitted or expired. It is not automatically
FAILED. Unsupported RPC responses remain unresolved; retry the original signed attempt
when the provider recovers. Terminal receipts are returned without another chain lookup.

## Persistence, concurrency and privacy

The store rechecks the owned operation, preparation/message and cluster under parent
locks. A transaction-scoped signature advisory lock also serializes signatures across
operations. The signature/cluster uniqueness guard prevents one transaction from being
attached to another operation. Identical retries reuse the receipt; terminal rows
remain immutable. Competing successes serialize and only one finalizes an operation.
Other unresolved attempts may subsequently fail without erasing that success.

A terminal receipt update and the existing trigger-derived aggregate operation status
commit together. Database failures roll back terminal changes. Slots are returned as
integer decimal strings. One operation may have several retained attempts; the response
separates the selected receipt status from aggregate operation status.

Success is 200 with `operationReceiptResponseSchema` and `Cache-Control: no-store`,
including for UNKNOWN or FAILED. Unauthenticated requests return 401, wrong session
cluster 403, inaccessible/missing owned operation/preparation 404, invalid input 400,
and identity/evidence conflicts 409. Database infrastructure failures use the redacted
500 envelope. Valid signed attempts retained before an RPC conflict/outage remain
available for retry.

Reconciliation updates receipt and operation status only. It does not publish artworks,
mark documentation FINALIZED, create ownership/custody/verification history, or import
provenance. Those document projections and successful chain-event history belong to the
indexing workflow. This separation also prevents failed transactions from creating
successful domain history. Private canonical intent, wire, evidence and fulfillment
information never appear in the public response.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm program:test`, `pnpm typecheck`, `pnpm lint`,
`pnpm build`, `pnpm format:check` and `pnpm codegen:check`. Temporary test signers remain
in memory. Tests cover real Ed25519 signatures, v0/v1 decoding, generated instruction
families, altered messages/roles/hash bindings, unknown evidence, wrong genesis, matched
execution failures, terminal replay, cross-operation signature reuse, concurrent receipt
creation/finalization and database rollback. RPC responses are mocked. The existing
offline program harness separately exercises actual Registry/Core execution and rollback.
No live wallet transaction, Devnet deployment or public-network receipt is claimed.
