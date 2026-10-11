# Fresh-checkout local setup

These Bash/Linux instructions start Katha's web application, API and database
from public repository files. They do not require helper documents, source logo
directories, existing databases or signing keys. The application includes the
artwork, administration and collector workflows; chain operations additionally
need configured programs, authorities, a worker and wallet approvals.

## 1. Select the pinned tools

Install Git, nvm and Docker Engine with Compose. For program builds and local
chain tests, also install Rust through rustup, AVM/Anchor, Solana and Surfpool.
Keep the coupled Solana toolchain pins; do not substitute global defaults.

| Tool       | Required version | Check                       |
| ---------- | ---------------- | --------------------------- |
| Node.js    | 24.21.0          | `node --version`            |
| pnpm       | 12.6.0           | `pnpm --version`            |
| Rust       | 1.95.0           | `rustc --version`           |
| Anchor CLI | 1.2.0            | `NO_DNA=1 anchor --version` |
| Solana CLI | 4.1.2            | `avm solana resolve`        |
| Surfpool   | 1.6.0            | `surfpool --version`        |

See [workspace setup](workspace.md), [Anchor workspace](anchor-workspace.md) and
[program testing](program-testing.md). Start Docker Engine; `docker info` must
report a server before database checks. On systemd Linux this may require
`sudo systemctl start docker` in your own terminal.

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

Expected runtime versions are `v24.21.0` and `12.6.0`. If pnpm is missing,
use the pinned install command in [workspace setup](workspace.md). Allow the
reviewed native install scripts. The frozen install must preserve the lockfile.

## 3. Configure, migrate and build

On a **new checkout**:

```bash
cp .env.example .env
```

Choose a local database password and update `DATABASE_URL` to match its user,
password, name and port. Percent-encode URL credentials. If port 5432 is occupied,
change `KATHA_DB_PORT` and the URL together. Keep `.env` private. On an existing
checkout edit the file instead of replacing it; Compose initialization values
do not reset an existing volume's credentials.

```bash
pnpm db:start
pnpm db:status
pnpm db:migrate
pnpm build
```

The database must be healthy and migrations must succeed before starting the API.
A build does not migrate, deploy programs, seed real artworks or start the worker.
Optional `pnpm db:seed` creates explicitly fictional drafts in a disposable
rehearsal database; it is not a real-artwork acceptance run.

## 4. Start the API and web

Start the API from the root in one terminal; its script loads the root `.env`:

```bash
pnpm --filter @katha/api dev
```

Start the web in another terminal. Pass public settings explicitly because
Next.js does not load the root `.env` through the API script:

```bash
KATHA_CLUSTER=localnet \
KATHA_PUBLIC_APP_ORIGIN=http://localhost:3000 \
KATHA_PUBLIC_API_ORIGIN=http://localhost:3001 \
KATHA_PUBLIC_SOLANA_RPC_URL=http://127.0.0.1:8899 \
pnpm --filter @katha/web dev
```

These defaults support local browsing; they do not start a configured local chain.
The API root may return 404. Check `/health/live` and `/health/ready` on port 3001;
readiness confirms the database, not chain/indexer health. Open the web on port 3000. An empty catalogue is expected until an artwork passes publication checks.

| Route                                  | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `/` and `/explore`                     | Cultural introduction and published artwork discovery          |
| `/artists/{slug}` and `/art/{kathaId}` | Attribution, documentation and public provenance               |
| `/account`                             | Wallet connection and separate signed-message authentication   |
| `/admin` and `/admin/artworks`         | Authorized artist onboarding and artwork workflows             |
| `/collection`                          | Authenticated holdings, listings, delivery and resale requests |

Empty allowlists deny administration. Sign-in alone does not grant roles; both
API allowlists and current on-chain authorities must match. Connection, message
sign-in and transaction approval are separate actions.

Stop only the processes you started with Ctrl+C. `pnpm db:stop` preserves the
named volume. Preserve the database and local `.storage` together after onboarding;
resetting identity counters while retaining on-chain records can cause collisions.

## 5. Choose Devnet demonstration or isolated local tests

For the existing public Devnet deployment, follow the
[network snapshot](devnet-network.md) and [ordered demonstration](devnet-demo.md).
Use Devnet settings in **both** API and web, configure the matching role allowlists,
and start the indexer with its collection and start slot. Do not initialize the
existing singleton configurations again. Resolve gaps before trusting ownership
or publication projections. For phone NFC, select reachable LAN origins before
preparing immutable documents; localhost on a phone points to that phone.

Automated tests instead use synthetic data and temporary local identities.
`pnpm program:test` starts its own offline Surfpool instance, while database and
browser integration runners own disposable PostgreSQL containers and ports.
Their first program run retrieves a hash-checked Core binary from Devnet.
They do not use your wallet or perform the physical demonstration.

## 6. Verify the setup

```bash
pnpm format:check
pnpm codegen:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm devnet:test
pnpm --filter @katha/web test:public-journeys
pnpm db:test
cargo fmt --all -- --check
cargo check --workspace --locked
pnpm program:build
pnpm program:test
```

Install the pinned Playwright Chromium browser if absent:
`pnpm --filter @katha/web exec playwright install chromium`. System dependencies
may also need installation. Database tests require Docker and the cached image
`postgres:18.6`; fetch it with `docker pull postgres:18.6` if needed.

The full browser journeys are `pnpm test:e2e`, `pnpm test:e2e:custody`,
`pnpm test:e2e:collector` and `pnpm test:e2e:trust`. These also require the program
build tools, verified Core fixture, Surfpool, Docker and Chromium. See the
[verification record](mvp-verification.md) for actual results and remaining manual
acceptance. A passing automated journey does not verify a real artwork or NFC tag.

Only reviewed IDLs and generated clients belong in Git. Environment files,
keypairs, compiled programs, storage, database contents, logs and test reports
remain ignored. See [local services](local-services.md) for persistence and
[CI](ci.md) for the narrower checks run by GitHub Actions.
