# Complete local Registry lifecycle

Follow the [local setup](getting-started.md) and install the pinned program tools
listed in the [program testing guide](program-testing.md). From the repository root:

```bash
pnpm program:test
```

Expected result: two integration files and four passing cases. The Registry
cases contain many lifecycle and failure assertions; the case count is not the
number of instructions tested. The runner builds the test program, verifies the
cached Core binary, starts offline Surfpool on temporary loopback ports, loads
both programs, and stops the process when the tests finish.

## RPC journey

`packages/solana/tests/registry-config.test.ts` runs the following Surfpool journey
with a synthetic Paubha and separate bootstrap, registration, verifier, and custody
authorities. Each successful artwork operation uses the generated-client builders,
fresh blockhash context, unsigned simulation, and temporary in-memory test signers.
The Kit RPC plugin submits and confirms the instruction; assertions then read
actual program-owned accounts through RPC.

| Operation                 | Evidence checked                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initialize platform       | Upgrade authority, role keys, canonical PDAs, Core collection authority; unauthorized and repeated bootstrap fail                                                    |
| Register identity         | Permanent Katha ID, artist identity, optional creator wallet, category, creation year, and evidence commitment; duplicate registration fails                         |
| Verify artwork            | Configured verifier and original evidence hash; a different signer cannot create verification                                                                        |
| Record initial inspection | Canonical condition document hash, version, artwork link, and verifier                                                                                               |
| Attest Katha custody      | Separate custody head and immutable transition, revision one, Katha-held state                                                                                       |
| Commit initial metadata   | Version-one document hash and URI retained in its revision account                                                                                                   |
| Mint Core asset           | Canonical asset bound atomically, expected collection/name/URI, registration authority as initial owner; duplicate mint fails                                        |
| Revise minted metadata    | Version-two hash and URI agree with the Core URI; stale replay fails without changing the current head or asset                                                      |
| Check final invariants    | Collection has one minted asset and current size one; registration attribution and earlier verification, inspection, custody, and metadata accounts remain unchanged |

Replay failures are also tested using unsigned simulation so a previously seen
transaction signature cannot mask an instruction-level failure. The independent
LiteSVM suite covers additional authorization, forged account relationships,
invalid custody movements, missing mint prerequisites, metadata drift, and
failed-CPI/rent rollback. Both runtimes execute the real pinned Core program.

## Test boundary

Surfpool cheatcodes provision synthetic balances and the test upgrade authority.
Artwork state changes use program instructions. No existing wallet or keypair is
read, and no transaction goes to Devnet. Metadata and condition bytes are synthetic;
the fixture URLs under `https://katha.fun/test/` are identifiers and are never
fetched or published. Binary caches and test output remain ignored.

This verifies the Registry portion of the MVP. Physical inspections remain manual
claims; public content storage, indexing, NFC, purchases, resale, and the two-wallet
Devnet demonstration are implemented in later phases. The test-only CPI probe
must never be deployed; see [program testing](program-testing.md).
