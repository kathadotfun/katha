# Cross-system trust and recovery tests

Run from the repository root:

```bash
pnpm test:e2e:trust
```

Use the pinned local toolchains, Docker, cached PostgreSQL/Core fixtures and
Playwright Chromium described in the [primary journey guide](primary-journey-tests.md).
This command builds the applications, runs the real program failure suites, then
runs the complete [collector-held browser journey](collector-resale-tests.md)
with deliberate failures. It owns disposable chain, database, storage and application
services; no developer environment, existing wallet or real artwork data is used.
No Devnet deployment or mainnet operation occurs.

## Failure evidence

| Boundary           | Failure and acceptance evidence                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions           | A real signed challenge is accepted once, then its exact replay returns 401. Existing role and private fulfillment guards remain exercised throughout the journey.                                                                                                                                                                                       |
| Wallet approval    | The synthetic Wallet Standard wallet rejects A's first purchase signature. The production interface reports that no transaction was submitted. Actual Core ownership, buyer token balance and transfer history remain unchanged; a fresh review then completes the purchase.                                                                             |
| Metadata           | One byte of the current public metadata file is corrupted without changing its size. Protected metadata review rejects it and public storage cannot serve it successfully. The owned read-only fixture is temporarily made writable; its original bytes and permissions are restored in a finally block, and its hash is checked against the commitment. |
| Chain accounts     | The local RPC bridge substitutes the wrong program owner for the artwork account. Inspection review rejects the forged account; the actual upstream Registry accounts remain unchanged.                                                                                                                                                                  |
| Inspection age     | The disposable chain configuration temporarily uses one-second inspection validity. The older approved report becomes EXPIRED, listing preparation rejects it, and the later buyer quote also rejects it while listed. The original configuration bytes are restored and checked after each rejection.                                                   |
| Program settlement | The program suites also reject forged bindings, wrong signers/recipients/mints, expired inspection at purchase and settlement failures against loaded programs, checking no partial payment or transfer.                                                                                                                                                 |
| RPC and restart    | The bridge returns HTTP 502. Protected inspection review returns a redacted error, and a separately spawned real indexer exits unsuccessfully. Public event history remains unchanged. With RPC restored, new worker processes resume from persisted checkpoints and replay without duplicate history.                                                   |
| Privacy            | Error responses and logs exclude session tokens, synthetic database credentials and raw injected errors. The full collector journey also checks public responses/history/logs for synthetic shipping details and private inspection notes.                                                                                                               |

These tests preserve artist attribution, ownership and physical custody as separate
facts. After recovery the ordinary two-wallet lifecycle still completes, with exact
test-token balances, immutable historical records, condition/custody milestones,
public collection ownership and permanent NFC resolution checked independently.

## Fault scope and cleanup

`surfpoolIndexerRpc` accepts only a loopback upstream. Its optional test-only fault
controls affect responses to selected account reads or cause a local RPC outage;
account faults preserve unrelated rows and signed transaction submissions. Unit
checks cover fault targeting and reset. Account response handling follows the
[Solana getMultipleAccounts format](https://solana.com/docs/rpc/http/getmultipleaccounts).

All faults, corrupted bytes, temporary fixture permissions and shortened inspection configuration are restored in finally blocks. Configuration overrides affect only the disposable synthetic chain so API reads and program simulation use the same validity. The test's existing synthetic funding
and program-authority bootstrap remain local only. This test is evidence of the
covered failure paths, not an audit or proof that every possible fault is handled.
The original primary and both resale commands retain their own scenarios.
