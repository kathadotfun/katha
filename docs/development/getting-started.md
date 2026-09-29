# Fresh-checkout local setup

This guide reproduces the current development foundation from a clean public
checkout. The web page and API are scaffolds; artwork behavior and database
connections are added in later steps. These commands use Bash on Linux.

## 1. Install the prerequisites

Install Git, Docker Engine with Compose, nvm, Rust through rustup, AVM/Anchor,
and the Solana CLI. Start Docker Engine and verify it is reachable. The repository
pins these versions; select them before installing project dependencies:

| Tool       | Required version | Check                       |
| ---------- | ---------------- | --------------------------- |
| Node.js    | 24.21.0          | `node --version`            |
| pnpm       | 12.6.0           | `pnpm --version`            |
| Rust       | 1.95.0           | `rustc --version`           |
| Anchor CLI | 1.2.0            | `NO_DNA=1 anchor --version` |
| Solana CLI | 4.1.2            | `avm solana resolve`        |

See [workspace setup](workspace.md) for the Node/pnpm selection commands and
[Anchor workspace](anchor-workspace.md) for the coupled Anchor/Solana build
configuration. `docker info` must report a server version before starting the
local database. The current Docker/Compose installation is described in the
[local service guide](local-services.md).

## 2. Clone and install

```bash
git clone https://github.com/kathadotfun/katha.git
cd katha
nvm install
nvm use
node --version
pnpm --version
pnpm install --frozen-lockfile
```

The version checks should print `v24.21.0` and `12.6.0`. If pnpm is missing,
install the pinned version using the command in [workspace setup](workspace.md),
then repeat the version check and frozen install. Keep install scripts enabled so
native packages can install their binaries.

## 3. Start the local database and apps

```bash
cp .env.example .env
# Edit .env and replace the example password; keep this file local.
pnpm db:start
pnpm db:status
pnpm dev
```

The database should become healthy before `db:start` exits. If local port 5432
is occupied, set a free `KATHA_DB_PORT` in `.env`. The development web scaffold
opens at `http://localhost:3000`. The API listens on `http://localhost:3001`;
its root path currently returns 404 because no public routes are implemented yet.
Stop the app processes with Ctrl+C. Run `pnpm db:stop` when done; the database
volume remains for the next start. See [local services](local-services.md) for
readiness and persistence details.

## 4. Check the foundation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
docker compose config --quiet
cargo fmt --all -- --check
cargo check --workspace --locked
NO_DNA=1 anchor build --ignore-keys
```

The checks should exit successfully. Anchor builds both empty programs and
regenerates their IDLs locally; it does not deploy them. The Solana program build
is separate from [GitHub Actions foundation CI](ci.md), which currently checks
Rust host compilation. No wallet or private key is needed for these checks.

`.env`, downloaded dependencies, generated binaries, local database contents,
and signing material stay outside public Git history. Only the safe
`.env.example` belongs in a public commit.
