# Foundation CI

GitHub Actions runs the foundation checks on pushes and pull requests targeting
`main`. The workflow grants the repository token only `contents: read` and does
not require secrets or local helper files.

The workspace job installs the pinned Node and pnpm versions from the repository,
requires the committed lockfile, then checks formatting, linting, types, builds,
and the safe Docker Compose configuration. The Rust job selects Rust 1.95.0 and
checks formatting and host compilation of both empty Anchor programs.

Run the same checks locally from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
docker compose --env-file .env.example config --quiet
cargo fmt --all -- --check
cargo check --workspace --locked
```

CI currently checks Rust host compilation, not the Solana program binary build,
IDL generation, database behavior, or application journeys. The pinned Anchor
build can be checked locally with `NO_DNA=1 anchor build --ignore-keys`; later
steps add program and application behavior tests as those features are built.
