# Developer guide

Start with [local setup](getting-started.md). Use the [operations guide](operations.md)
for running services, transaction recovery, indexing and NFC. The
[MVP specification](../product/mvp.md) defines scope; the
[architecture](../architecture/overview.md), [lifecycle](../architecture/artwork-lifecycle.md)
and [trust decision](../decisions/0001-trust-and-lifecycle.md) explain the design.

## Where to make changes

| Concern                                         | Source of truth                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes, validation and access guards            | [API router](../../apps/api/src/app.ts) and its domain modules                                                                                 |
| Request/response shapes and domain rules        | [Shared schemas](../../packages/shared/src)                                                                                                    |
| Tables and forward migrations                   | [Schema](../../packages/db/src/schema) and [migration SQL](../../packages/db/drizzle)                                                          |
| Public, collector and admin UI                  | [Routes](../../apps/web/app), [components](../../apps/web/components) and [controllers](../../apps/web/lib)                                    |
| Visual tokens and reusable UI                   | [Styles](../../apps/web/app/globals.css) and [UI components](../../apps/web/components/ui)                                                     |
| Chain reads, unsigned builders and Core adapter | [Solana package](../../packages/solana/src)                                                                                                    |
| Registry and Marketplace enforcement            | [Registry](../../programs/katha_registry/src/lib.rs) and [Marketplace](../../programs/katha_marketplace/src)                                   |
| Commands, dependencies and toolchain pins       | [Manifest](../../package.json), workspace manifests, [Anchor configuration](../../Anchor.toml) and [Rust toolchain](../../rust-toolchain.toml) |

Read source contracts and nearby tests for exact fields, limits, errors and
instruction layouts. They are maintained with the implementation; this guide
does not duplicate an endpoint catalogue or a guide for every component.

Application code uses Kit types. Keep Umi and compatibility types inside the Core
adapter. HTTP/domain contracts belong in shared Zod schemas rather than copied
TypeScript interfaces. Preserve artist attribution and permanent Katha IDs; keep
ownership, custody, verification, listing and inspection approval independent.

UI changes should keep artwork photography, the artist and story prominent. Use
existing visual tokens and reviewed brand assets. Preserve keyboard access,
visible focus, reduced motion, responsive layouts and text labels for status.
Private records must clear when a wallet/session changes.

The interface uses Geist and Geist Mono, cotton-paper textures, and dark/light
color tokens. The header theme switch persists only the theme preference; wallet
sessions remain in memory. Public pages use the top navigation, while collector
and operations pages use the responsive sidebar shell. Reuse those surfaces for
additional forms, dialogs, loading and recovery states.

Public navigation reveals on upward scrolling and hides after a short idle pause;
open menus, pointer interaction and visible keyboard focus keep it available.
Coarse mouse-wheel steps ease between positions, while precision gestures, touch,
keyboard scrolling and nested scrollable controls retain native behavior. Reduced
motion disables easing. The Back to top control restores focus to the main content.

Introductory paintings under `apps/web/public/design/paintings` are labelled
AI-generated design illustrations. They are not catalogue inventory, artist
attributions or transaction evidence. Published artwork images come from the API.
The new-artwork evidence picker hashes a user-selected file locally; it uploads
only the digest through the existing draft form, never the evidence file.

## Database changes

After changing a schema, generate and review a forward migration:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:test
```

Run migrations serially against the intended database. Include reviewed SQL,
snapshots and journal changes together; preserve custom trigger/function SQL.
Applied migrations are historical records. Add a forward migration rather than
rewriting applied SQL, using schema push or migrating automatically at startup.

`pnpm db:seed` creates fictional, unverified drafts in supported local rehearsal
databases. It consumes permanent IDs and does not create verification, custody or
sales. Use a disposable database for fixtures and preserve real database/storage
pairs; see [data preservation](operations.md#database-and-storage).

## Program and generated-client changes

Keep the coupled toolchain pins in [local setup](getting-started.md). Use Core's
standard Rust CPI interface without its optional older Anchor integration.
After a Rust instruction or account change:

```bash
pnpm program:build
pnpm codegen
pnpm codegen:check
pnpm --filter @katha/solana typecheck
pnpm --filter @katha/solana test
pnpm program:test
```

The normal build emits [Anchor IDLs](../../target/idl); Codama generates
[Registry](../../packages/solana/src/generated/registry) and
[Marketplace](../../packages/solana/src/generated/marketplace) clients from them.
Never edit generated clients or IDLs manually. Include affected IDLs and generated
source with program changes. Keypairs and compiled binaries remain ignored.

`codegen:check` compares generated filenames and bytes without repairing source.
CI runs it against committed IDLs; it does not prove that IDLs match Rust.
Rebuild IDLs locally when program source changes. Generated decoders do not
replace account-owner, PDA, collection, authority or lifecycle validation.

## Verification

Run checks appropriate to the change. Include authorization, invalid-input and
failure/rollback cases with trust-critical changes. Use nearby tests for detailed
scenarios rather than maintaining a second written list of assertions.

| Check                              | Command                                                                                   | Requirements / scope                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Formatting                         | `pnpm format:check`                                                                       | Public source and docs                                   |
| Generated client freshness         | `pnpm codegen:check`                                                                      | Reviewed IDLs and installed dependencies                 |
| Lint and types                     | `pnpm lint`, `pnpm typecheck`                                                             | Workspace checks                                         |
| Production compilation             | `pnpm build`                                                                              | All application packages                                 |
| Unit tests                         | `pnpm test`                                                                               | Synthetic tests; no development database required        |
| Database/API integration           | `pnpm db:test`                                                                            | Docker and `postgres:18.6`; disposable database          |
| Public configuration               | `pnpm devnet:test`                                                                        | Read-only plan/configuration tests                       |
| Browser and accessibility          | `pnpm --filter @katha/web test:public-journeys`                                           | Chromium; synthetic HTTP fixtures                        |
| Collector and shell browser checks | `pnpm --filter @katha/web test:account`, `pnpm --filter @katha/web test:responsive-shell` | Chromium; synthetic HTTP fixtures                        |
| Rust format and compile            | `cargo fmt --all -- --check`, `cargo check --workspace --locked`                          | Pinned Rust toolchain                                    |
| SBF build / Core compatibility     | `pnpm program:build`, `pnpm program:test`                                                 | Pinned program tools, Surfpool and reviewed Core fixture |
| Authorized admin integration       | `pnpm admin:test`                                                                         | Disposable database and built API                        |
| Primary collecting                 | `pnpm test:e2e`                                                                           | Local-chain browser journey                              |
| Katha-held resale                  | `pnpm test:e2e:custody`                                                                   | Local-chain browser journey                              |
| Collector-held resale/delivery     | `pnpm test:e2e:collector`                                                                 | Local-chain browser journey                              |
| Trust failures and recovery        | `pnpm test:e2e:trust`                                                                     | Program tests and local-chain browser journey            |

Browser journeys need Docker, Chromium, Surfpool, program build tools and the
reviewed Core fixture. Install Chromium if absent with
`pnpm --filter @katha/web exec playwright install chromium`; system dependencies
may also be required. Browser scripts build/start local services, so avoid running
them against a checkout whose build output serves an active demonstration.

`program:test` downloads a public Core binary on first use and checks its pinned
SHA-256 before loading it into isolated local runners. A changed hash must stop
the test for review. Move an outdated cached fixture aside only after reviewing
its replacement; never bypass integrity checks. The `core-cpi-test` feature adds
a local probe in a separate test build; do not deploy that binary. See the
[fixture review record](mvp-verification.md#reviewed-core-fixture-refresh).

See [test harnesses](../../scripts) and package test directories for the actual
scenarios. [CI](../../.github/workflows/ci.yml) is authoritative for GitHub Actions
checks; it does not run SBF builds, Core program tests or the complete local-chain
browser journeys. The [verification record](mvp-verification.md) distinguishes
recorded results from pending real-artwork acceptance.

## Documentation maintenance

Update docs when setup, usage, public contracts, operating procedures, product
scope or design assumptions change. Internal refactors normally need code and
appropriate tests. Keep precise fields, defaults, dependency versions and test
assertions in their source files unless developers need them to run the project
or make a decision.

Keep setup in one place, recovery recipes in the operations guide and substantial
design rationale in architecture decisions. Add a separate document only for a
distinct need these guides cannot cover. Working notes, screenshots, test logs
and private evidence stay outside public Git history.
