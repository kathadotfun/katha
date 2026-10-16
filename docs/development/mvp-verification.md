# MVP verification and remaining acceptance

Status on **2026-10-11**: software workflows implemented, Devnet bootstrap recorded,
final acceptance open. The real-artwork, two-wallet and physical NFC demonstration
is deferred. No completed physical-artwork lifecycle is claimed.

## Evidence boundaries

| Evidence                                                                                              | What it establishes                                                                                                             | What it does not establish                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Devnet network snapshot](devnet-network.md)                                                          | Recorded successful program deployment, collection and singleton initialization, public account relationships and binary hashes | Live health, artwork verification, purchases or physical custody  |
| [Primary browser journey](README.md#verification)                                                     | Synthetic local-chain onboarding and first purchase assertions                                                                  | A real artist's consent or an actual collector purchase on Devnet |
| [Retained-custody resale](README.md#verification) and [collector-held resale](README.md#verification) | Automated custody/inspection rules and sale assertions                                                                          | Physical inspection, shipment or receipt                          |
| [Trust and recovery suite](README.md#verification)                                                    | Automated rejection, rollback, privacy and recovery assertions                                                                  | Audit certification or production readiness                       |
| [Manual demonstration guide](devnet-demo.md)                                                          | Ordered operator instructions and unchecked evidence requirements                                                               | Completion merely because the guide exists                        |

The [product specification](../product/mvp.md#14-acceptance-criteria) remains the
acceptance contract. Previous automated journey results describe synthetic tests
performed during implementation; they are not fresh-run results for every current
external dependency.

## Fresh public-file setup checks

A separate temporary checkout was extracted from the committed public tree at
`b0f2f7bbddebe7dd0d34a30b23a1564ff73f75c1`. It contains no helper files, local
`.env`, artwork uploads, existing database, keypairs or uncommitted component edits.
Dependencies were installed from the unchanged lockfile using the available package
store. This verifies clean dependency linking, not installation on every OS or
from an empty internet cache. The refreshed documentation accompanies this record. After the initial integrity
and timing failures, the same checkout received only this step's reviewed fixture
pin and synthetic report-clock wait changes for the final reruns.

| Check                                                                              | Result                                                                |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Node 24.21.0, pnpm 12.6.0, Rust 1.95.0, Anchor 1.2.0, Solana 4.1.2, Surfpool 1.6.0 | Selected versions confirmed                                           |
| `pnpm install --frozen-lockfile`                                                   | Passed in the separate checkout; no manifest or lockfile changes      |
| `pnpm format:check`, `pnpm codegen:check`, `pnpm lint`, `pnpm typecheck`           | Passed                                                                |
| `pnpm exec turbo run build --force`                                                | Passed, all five packages rebuilt without task cache hits             |
| `cargo fmt --all -- --check`, `cargo check --workspace --locked --offline`         | Passed                                                                |
| `pnpm devnet:test`                                                                 | Passed, four public configuration/plan tests                          |
| `pnpm test`                                                                        | Pending final run                                                     |
| `pnpm --filter @katha/web test:public-journeys`                                    | Pending final run                                                     |
| `pnpm program:build`                                                               | Pending final run                                                     |
| `pnpm db:test` and clean migration/service readiness                               | Pending Docker availability                                           |
| `pnpm program:test`                                                                | Stopped at the Core binary integrity gate; see below                  |
| Full clean local-chain browser journeys                                            | Not rerun: require Docker and resolution of the Core fixture mismatch |

The first restricted Next.js build attempt failed because a CSS worker could not
bind a local port. Removing only that temporary checkout's failed build cache and
rerunning with permitted local sockets passed. This was an execution restriction,
not a source change or a bypass of a product check.

The first IDL-generation attempt exhausted available disk space. Only task-owned
temporary debug artifacts were removed; the retry disabled host debug information
to reduce disk use. SBF program source and toolchain pins were unchanged. Client
freshness was rechecked against the regenerated IDLs.

## Reviewed Core fixture refresh

The fresh [program harness](README.md#verification) download initially failed its
integrity check. The public Devnet Core program
`CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` is owned by the upgradeable
loader, with ProgramData `9ZC25KLUrfgSoFVgjE1rrydZBbZns58UXi8A8ZhTdGfr`.
The inspected deployment reports slot **509311714** and 855,888 program bytes.
The read-only CLI download hashes to
`7e033fd24ce189d9e7dc2600152c6c88ce80d662deeeb7ecc64f0c8437867cf7`, replacing
the older cached fixture pin
`5680d2371204033f55cdcf0c08d393ed737d99cfe35d83f65befe80f7537484a`.

The candidate binary was tested in the separate checkout before updating the
fixture pin. All 46 existing program tests passed, exercising Core CPI, lifecycle,
metadata, delegates and settlement failure cases. Both final local-chain browser journeys passed against the reviewed candidate. This establishes tested compatibility, not an audit
or reproducible build of Core's external source.

The fixture SHA-256 in `scripts/test-core-cpi.mjs` is refreshed. The synthetic
browser harness also applies its existing bounded chain-clock wait to the initial
condition report, as well as later inspections. The first full journey correctly
rejected a report timestamp ahead of its chain snapshot; application validation
remains unchanged. Program source, IDL interfaces, clients and coupled
toolchain/dependency pins are unchanged.
The binary stays ignored. If an existing checkout still has the old cached fixture,
move it aside and rerun the harness to download the reviewed binary. Future Core
changes must again stop at the integrity gate and receive compatibility review;
do not bypass the check or silently accept arbitrary bytes.

## Remaining completion gates

- [x] Review the fresh Core binary and pass the program compatibility suite.
- [x] Repeat full local-chain browser journeys against that reviewed binary.
- [x] Verify migrations and synthetic constraints from a separate clean database.
- [ ] Verify the complete application/worker startup and restart with the final
      Devnet demonstration configuration.
- [ ] Complete approved real-artwork onboarding and condition inspection.
- [ ] Verify Wallet A's primary purchase and Wallet B's inspected resale on Devnet.
- [ ] Verify both retained Katha custody and collector-held physical workflows.
- [ ] Write/read the NFC tag and repeat phone taps after ownership changes.
- [ ] Retain the public signatures, finalized owner/custody/condition evidence and
      stable artwork ID; keep private evidence and fulfillment details outside Git.
- [ ] Review public responses and publication contents before claiming acceptance.

Use the [ordered demonstration guide](devnet-demo.md) to collect actual evidence.
After it succeeds, update this status and the network manifest's demonstration
flag using the recorded outcomes. Do not infer completion from bootstrap receipts,
a build, mock wallet tests or publication of these documents.

## Operational limits

Application services, media storage, PostgreSQL and polling worker run locally or
on a configured LAN. Photos and canonical JSON are off-chain; Registry commitments
and Core ownership are on-chain. Listing does not move the physical artwork, and
payment/ownership finalization does not assert shipping or delivery. Public NFC
finds a permanent artwork record and can be copied.

Devnet payments use the six-decimal test mint with no cash value. The 250-basis-point
commission, 500-basis-point secondary royalty and 30-day inspection default are
development settings. Wallet approvals, physical authentication and fulfillment
remain operator actions. Hosted `katha.fun`, mainnet, production payment/legal
settlement and the specification's future features remain outside this sequence.
