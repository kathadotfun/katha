# Local PostgreSQL service

Katha uses the official PostgreSQL 18.6 image for local development. The Compose
service is named `db`, binds only to `127.0.0.1`, and stores database files in a
named volume mounted at `/var/lib/postgresql`. PostgreSQL 18 uses a versioned
`PGDATA` directory under that mount. The Node database package gains a connection
and migrations in later steps; it does not connect yet.

## Start and inspect

Install Docker with Compose and start Docker Engine first. `docker info` should
report a server version. Then run these commands from the repository root:

```bash
cp .env.example .env
# Edit .env and replace the example password. Keep .env local.
pnpm db:start
pnpm db:status
```

The example contains disposable values only. Compose requires nonempty database
name, user, and password values; `KATHA_DB_PORT` defaults to 5432. If that host
port is occupied, set another port in `.env`. The start command returns only
after the PostgreSQL health check succeeds. A local client can connect to `127.0.0.1` on
that port using the values in `.env`.

With the unchanged example user and database, inspect readiness from inside the
container:

```bash
docker compose exec -T db pg_isready -U katha_dev -d katha_dev
docker compose exec -T db psql -U katha_dev -d katha_dev -At -c 'SHOW server_version;'
```

Expected output includes `accepting connections` and `18.6`. If you changed the
user or database names, use your chosen values in those commands.

Stop the service with `pnpm db:stop`. The named volume remains, so the database
persists across ordinary stop/start cycles. The ignored `.env` file and database
contents stay outside public Git history. Commit only `.env.example` and the
service configuration, never a working `.env` or database files.

The [PostgreSQL version policy](https://www.postgresql.org/support/versioning/)
identifies 18.6 as the current stable minor release for major version 18. The
[official image documentation](https://hub.docker.com/_/postgres) describes the
PostgreSQL 18 volume path and initialization variables.
