# Foundation CI

GitHub Actions runs the foundation checks on pushes and pull requests targeting
`main`. The workflow grants the repository token only `contents: read` and does
not require secrets or local helper files.

The workspace job installs the pinned Node and pnpm versions from the repository,
requires the committed lockfile, then checks formatting, linting, types, builds,
unit tests, disposable PostgreSQL migration/constraint tests, and the safe Docker
Compose configuration. It pulls the pinned `postgres:18.6` image; the test runner
creates and removes its own container and fresh fixture databases with synthetic
credentials and no persistent volume. The Rust job
selects Rust 1.95.0 and checks formatting and host compilation of the Registry and Marketplace programs.

Run the same checks locally from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm codegen:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
docker pull postgres:18.6
pnpm db:test
docker compose --env-file .env.example config --quiet
cargo fmt --all -- --check
cargo check --workspace --locked
```

CI currently checks Rust host compilation, not the Solana program binary build,
IDL regeneration or application journeys. Generated-client freshness is checked
against committed reviewed IDLs. Database behavior is covered by the disposable
constraint and [fictional fixture suites](database-fixtures.md). The pinned Anchor
build can be checked locally with `NO_DNA=1 anchor build --ignore-keys`; later
steps add program and application behavior tests as those features are built.
