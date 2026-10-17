# Operations guide

Use [local setup](getting-started.md) for first startup, the
[network snapshot](devnet-network.md) for the recorded deployment and the
[two-wallet demonstration](devnet-demo.md) for the artwork workflow.
[Deployment and bootstrap](devnet-deployment.md) is a separate operator procedure;
existing singleton configurations must not be initialized again.

The requested 2-of-3 governance and operational-wallet migration is specified in
[ADR 0002](../decisions/0002-authority-and-settings-migration.md), including artist
consent, incident recovery and transaction grouping. Both programs now include a
verified two-sided Squads root-handover instruction, but the full migration and
its operational role/recovery controls remain pending. No authority transfer is
performed by installation, build or environment changes. Current role wallets,
treasury, payment mint, inspection validity and artist payout still have their
existing initialization constraints. See the ADR's implemented-foundation section
before preparing any handover; a reviewed live migration manifest is still needed.

## Configuration and service health

[`.env.example`](../../.env.example) lists operator settings;
[server validation](../../apps/api/src/config.ts) enforces them. Preserve the
ignored root `.env` when changing settings. The API and worker load it through
their package scripts. Pass public origins, cluster and browser RPC explicitly to
the web process, as shown in local setup. Restart affected services after changes.

- Match localnet/Devnet settings across API, web and worker.
- Configure both server RPC endpoints together. Keep provider credentials out of
  browser RPC settings, public files and logs.
- Empty admin/verifier allowlists deny access. Sign-in does not grant a role;
  on-chain authority checks are independent from API permissions.
- Origins must match the browser context. Changing app origin or cluster
  invalidates existing authentication context; reconnect and sign in again.

`GET /health/live` checks the HTTP process; `GET /health/ready` checks the database.
Neither proves chain history, indexing health or physical acceptance. The API does
not start the polling worker automatically.

## Database and storage

```bash
pnpm db:start
pnpm db:status
pnpm db:migrate
```

`pnpm db:stop` preserves the named volume. Initialization variables do not change
an existing volume's password or database. To create a separate demonstration
database without deleting existing data, choose an unused name:

```bash
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" katha_devnet_demo'
```

Update only the database component of the private `DATABASE_URL`, then migrate.
Keep localnet and Devnet datasets separate. After on-chain registration, preserve
artwork ID counters; an empty database can allocate IDs that already exist on chain.

Back up and restore the database and API storage together. Default storage is
`apps/api/.storage/` when using API package scripts. A server-only
`KATHA_STORAGE_ROOT` override must be an absolute normalized path ending in
`/.storage`, with an existing parent. Local files are not permanent archival storage.

Storage keys are content-addressed under `public/` and `private/`. Explicitly
approved public bytes can be accessible before catalogue publication; check
visibility before upload. Never mount the entire storage root publicly. Private
evidence, reports and fulfillment details stay restricted.

If a file is missing or fails integrity checks, restore its exact original bytes
from a trusted backup. Do not edit committed documents, overwrite hash-addressed
files or change database hashes to hide an error. Stop the API before inspecting
or removing crash-left `.pending-*` files; these unfinished writes are not valid
stored objects. Preserve finalized document history.

## Artwork workflow

### Fee settings

The Marketplace fee schedule defaults to 1,000 bps primary platform commission,
250 bps resale platform commission and 500 bps artist resale royalty. A 100-token
first sale pays 90 to the artist and 10 to Katha; a 100-token resale pays 92.5 to
the seller, 5 to the artist and 2.5 to Katha. Integer deductions round down;
the remaining units go to the artist on a primary sale and seller on resale.

After the operator upgrades Marketplace to the reviewed binary, use `/admin/devnet`
with the configured Marketplace authority. Existing Registry/Marketplace
singletons must not be reinitialized. Select **fees** once to initialize its
separate schedule. For later changes, edit `feeRates` in the public input JSON,
select **update-fees**, then prepare, inspect the displayed rates and approve
in the wallet. No program redeployment is needed for subsequent rate changes.
The signed instruction includes the expected schedule revision; a concurrent
update requires preparation again.
After a root handover, use an approved Squads vault execution for Marketplace root
operations. The current `/admin/devnet` page expects a single wallet signer and
cannot sign as the vault. A member wallet or the former authority is insufficient.

Only future listings use changed rates. A seller must cancel and relist to adopt
new terms. Old version-1 listings keep the original Marketplace config rates;
new version-2 listings use their canonical `ListingFees` snapshot. Cancellation
and expiry recovery remain available for both versions. Fees apply only to
sales executed through Katha, not external transfers or off-platform sales.

Payment mint, token program, treasury, authorities, collection and inspection
validity remain initialization settings. Changing those safely requires a
separate migration design, especially for historical attestations and custody.

### Registration and collecting

The [ordered demonstration](devnet-demo.md#4-document-the-artist-and-artwork)
contains route-by-route instructions. Keep these checkpoints distinct:

1. Obtain artist approval, document the physical work, preserve authorship evidence
   privately and record its exact SHA-256 digest. The digest commits to bytes; it
   does not upload evidence or independently prove authorship.
2. Finish draft/media review before preparing canonical metadata; preparation
   closes draft editing. Registration, verification and on-chain metadata
   commitment are separate actions.
3. Inspect the physical work and attest actual custody. Finalize metadata,
   condition and other mint prerequisites before minting. Publication is a separate
   database action requiring matching finalized/indexed evidence.
4. Bind the approved artist payout before listing. A profile payout field does
   not create immutable on-chain sale terms. Review exact test-token amounts,
   recipients, listing revision and expiry before signing.
5. Coordinate dispatch, receipt and collector-held resale inspection manually.
   Delivery requests and collector receipt claims do not themselves update Registry
   custody. Check current owner/custody scope before approving resale.

Core ownership and physical custody may identify different people. An owner seeing
“With a custodian” must coordinate the actual custody record with Katha rather
than claiming possession. A sale never automatically delivers a painting. Preserve
attribution, earlier reports and the permanent artwork ID.

## Transaction recovery

Connection, signed-message authentication and transaction approval are separate.
Review the operation, cluster, signer, accounts and amounts; simulate, approve
in the authorized wallet, then retain the signature. Simulation is not success.

| Observed state                         | Operator action                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Check failed before approval           | Resolve session, network or simulation issues and prepare again; nothing was sent                |
| Wallet rejected or altered the message | Resolve the wallet/account or fee-setting issue and review again; keep message validation intact |
| Signed outcome unknown                 | Reconcile the same signature; do not prepare a replacement while it might still land             |
| Definitively failed/expired receipt    | Reload the workflow and prepare a fresh attempt with a new wallet review                         |
| Finalized, indexing pending            | Recover the worker and recheck the saved operation; do not repeat the successful chain write     |

The application retains signed attempts before sending. While confirmation is
unknown, bounded follow-up can rebroadcast identical signed bytes while valid and
reconcile the retained signature; it never asks the wallet to re-sign. Blockhash
expiry alone does not prove an unknown signature failed. Only a conclusive receipt
opens a fresh retry. Reloading clears browser memory, so reconcile retained API
receipts before replacing a signed operation.

For a read-only CLI check, replace the public signature placeholder:

```bash
solana --url devnet confirm --verbose TRANSACTION_SIGNATURE
```

A finalized receipt, indexed history, Core ownership and physical acceptance are
distinct checkpoints. Bootstrap has separate in-memory limits; follow
[bootstrap recovery](devnet-deployment.md#recovery-and-verification-boundary) there.

## Indexer recovery

Apply migrations and build packages before starting the worker alongside the API.
Replace placeholders with the registered collection and a start slot including
registration; the [network snapshot](devnet-network.md) records the existing scope.

```bash
pnpm indexer:inspect
pnpm indexer:run <registered-collection-address> <start-slot>
```

`indexer:inspect` is a bounded read-only RPC preview, not a history import or a
database health check. The worker binds to the configured network, processes
finalized activity and commits events, projections and checkpoints atomically.
Core discovery is scoped to the collection. Registry, Core and Marketplace
observations preserve one sale/ownership change without duplicating provenance.
Activity reads retry transient RPC failures individually, preserving successful
reads within the page. Retries stop after five attempts, honor `Retry-After` up
to 30 seconds, and stop on cancellation; a longer provider cooldown is surfaced.
Malformed evidence and access/configuration failures are not retried. The Devnet
read-only deployment check uses the same policy; wallet submissions are unchanged.
Fresh Registry permission checks also retry transient configuration, genesis and
governance-bank reads within an eight-second overall read deadline. A retry reads
the grant and chain clock again; no permission is cached. Exhausted transient
provider failures return a service error rather than an authorization denial.
Malformed accounts, revoked/expired grants and pauses still deny access.

For a full replay from the acknowledged start, or a bounded historical replay:

```bash
pnpm indexer:run <registered-collection-address> <start-slot> --backfill --once
pnpm indexer:run <registered-collection-address> <start-slot> --backfill --once --through-slot=<end-slot>
```

The end slot must be finalized and cannot precede an existing scanned checkpoint.
Historical mode does not compare historical ownership with today's Core account;
resume normal polling to catch up and reconcile the current owner. Do not change
an acknowledged start or advance a cursor to hide missing history.

| Symptom                               | Recovery                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Rate limits/timeouts                  | Use a suitable server RPC pair with retained history; restart/replay from the existing scope |
| `PAGE_LIMIT`                          | Review history volume and `--max-pages=N` (1–1000); backfill without moving the start        |
| Missing boundary or pruned history    | Use an RPC retaining the required range; keep the gap visible until recovered                |
| Invalid evidence or unsupported state | Diagnose the reader/provider and replay validated history; do not manually clear the gap     |
| Stale ownership observation           | Allow another recovery/reconciliation cycle; a diagnostic is not a new provenance event      |
| Changed genesis / `NETWORK_UNBOUND`   | Preserve the old database; create a separate dataset and backfill the intended network       |

A prior Core checkpoint from program-wide discovery may require collection-scoped
backfill. Check provider batch limits as well as rate limits; mint review needs a
multi-account snapshot. A suitable RPC does not guarantee complete retained history.

Inspect recovery through read-only SQL in your configured PostgreSQL client:

```sql
SELECT cluster, program_address, from_slot, scanned_through_slot,
       gap_reason, gap_from_slot, gap_through_slot
FROM indexer_checkpoints;
SELECT cluster, registry_program, genesis_hash, finalized_slot, blocked
FROM indexer_networks;
SELECT cluster, artwork_id, source_event_id, status, observed_slot, checked_at
FROM ownership_reconciliations;
```

Preserve public signatures/checkpoints and redacted request IDs for diagnosis.
Never export RPC credentials, bearer tokens, private documents or shipping data
into logs or issue reports.

## NFC and LAN demonstration

Choose reachable API/web origins before creating immutable metadata. A phone's
`localhost` points to the phone. For a trusted LAN, replace the example laptop IP
in the ignored root `.env`, retaining database, cluster and role settings:

```dotenv
API_HOST=0.0.0.0
API_PORT=3001
KATHA_PUBLIC_APP_ORIGIN=http://192.168.1.87:3000
KATHA_PUBLIC_API_ORIGIN=http://192.168.1.87:3001
```

Restart the API and pass matching settings explicitly to the web:

```bash
KATHA_CLUSTER=devnet \
KATHA_PUBLIC_APP_ORIGIN=http://192.168.1.87:3000 \
KATHA_PUBLIC_API_ORIGIN=http://192.168.1.87:3001 \
KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com \
pnpm --filter @katha/web exec next dev --hostname 0.0.0.0 --port 3000
```

Both ports must be reachable from the phone. Check firewall/client isolation if
needed; PostgreSQL does not need exposure. Verify operator wallet/sign-in support
in the chosen browser context separately from public HTTP viewing. Domain ownership
alone does not provision HTTPS, hosted routing or a resolver.

Assign a new lowercase tag UUID through the artwork's NFC panel. Confirm the
binding and ACTIVE state before writing hardware. Write **one NDEF URI record**:

```text
<reachable-api-origin>/nfc/<assigned-lowercase-uuid>
```

Use the API resolver so retirement is checked on each tap. Read back and compare
the complete URL, then test it on the phone before and after attachment and each
sale. A published active tag returns 302 to the configured web origin's
`/art/<kathaId>?source=nfc` with `Cache-Control: no-store`. Unknown/private tags
return 404; publicly eligible retired tags return 410. Do not write the final
artwork URL as a workaround for resolver failures.

Retire a lost/replaced tag through the admin panel, then assign a new UUID to the
same artwork. Retirement is terminal: old UUIDs cannot reactivate or remap. Verify
the old URL no longer redirects and the replacement opens the same artwork ID.
Keep demonstration tags writable during testing. Basic NFC can be copied; it
proves neither authenticity, ownership, custody nor delivery.

Record physical checks privately and complete the
[manual acceptance checklist](devnet-demo.md#12-check-storage-failures-and-finish-evidence).
Automated tests cannot establish that a tag was written or a painting inspected.
