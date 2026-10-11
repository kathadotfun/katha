# Devnet deployment and bootstrap

This prepares a local or LAN demonstration against Solana Devnet. It does not
deploy a hosted website, establish production economics or demonstrate a real
artwork sale. Operators deploy programs and approve transactions themselves.
Actual network addresses and receipts are recorded after bootstrap; the example
configuration is a template, not evidence of deployment.

## Build and public deployment review

Use the repository pins: Node 24.21.0, pnpm 12.6.0, Anchor 1.2.0 and Solana CLI
4.1.2. The installed Solana tool bundle supplies `spl-token` 5.6.1. No additional
package installation is needed for this workflow. See [local setup](getting-started.md).

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm program:build
pnpm codegen:check
pnpm devnet:test
```

Both `Anchor.toml` cluster sections and the generated clients use these IDs:

| Program     | Public address                                 | Built binary                         |
| ----------- | ---------------------------------------------- | ------------------------------------ |
| Registry    | `Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr` | `target/deploy/katha_registry.so`    |
| Marketplace | `B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq` | `target/deploy/katha_marketplace.so` |

The Registry ID was aligned with the operator's available identity signer before
its first Devnet deployment. Registry PDA addresses and Marketplace references
therefore changed. Existing localnet read models, pending operations and assets
belong to the earlier program identity; use a fresh demonstration database and
network setup rather than mixing those records with this deployment. This does
not migrate existing artworks or rewrite their provenance. The Marketplace ID
remains unchanged.

Building uses `--ignore-keys`; it must not change those public identities. Before
an initial deployment, the operator checks that each existing program identity
keypair produces the corresponding public address, using `solana-keygen pubkey`
in their own terminal. Keep those files outside public Git. If an identity signer
is unavailable, stop: generating a different key does not deploy at the pinned ID.
An existing deployment requires its current upgrade authority instead.

Keep signing credentials in the operator's own CLI configuration or hardware
wallet. Never put a keypair, seed phrase, RPC credential or signing token in the
bootstrap JSON, environment examples or review output. The Katha plan command
does not inspect CLI signing configuration or read keypair files.

## Operator deployment

All commands in this guide that write to Devnet are operator actions. Review the
program address, binary and selected CLI wallet before executing them. The
following paths are placeholders for the existing identity signers:

```bash
solana --url devnet address
solana --url devnet balance
solana --url devnet program show Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr
solana --url devnet program show B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq
```

An absent program is expected on first deployment. On an existing deployment,
inspect its upgrade authority before deciding whether an upgrade is intended.
Request test SOL as needed using `solana --url devnet airdrop 2`; faucet limits
may require waiting. Deployment can cost more test SOL than the request above.

```bash
solana --url devnet program deploy target/deploy/katha_registry.so \
  --program-id /ABSOLUTE/PRIVATE/PATH/registry-identity.json
solana --url devnet program deploy target/deploy/katha_marketplace.so \
  --program-id /ABSOLUTE/PRIVATE/PATH/marketplace-identity.json
```

These commands use the selected CLI wallet as fee payer and initial upgrade
authority. Do not use `--final` or skip preflight. Deployment is separate from
initializing Katha accounts. The browser utility supports one bootstrap operator:
both upgrade authorities and the Registry platform authority must match that
connected wallet. Program instructions themselves support distinct bootstrap
signers; this utility deliberately does not coordinate multiple operator wallets.

If the CLI deployment wallet differs from the browser operator, transfer both
upgrade authorities explicitly. Replace `OPERATOR_PUBLIC_ADDRESS` with the
verified connected wallet address. The existing authority must sign; the flag
below permits a public new authority without requesting its CLI signer:

```bash
solana --url devnet program set-upgrade-authority \
  Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr \
  --new-upgrade-authority OPERATOR_PUBLIC_ADDRESS \
  --skip-new-upgrade-authority-signer-check
solana --url devnet program set-upgrade-authority \
  B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq \
  --new-upgrade-authority OPERATOR_PUBLIC_ADDRESS \
  --skip-new-upgrade-authority-signer-check
```

Repeat `program show` and record public results and deployment signatures. Future
upgrades now require the new authority. This guide does not automatically sign
upgrades or export the browser wallet to a CLI keypair.

## Test mint and collection metadata

Create a classic SPL mint with six decimals and no freeze authority. Use the
explicit classic Token program; do not enable extensions or freeze authority:

```bash
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  create-token --decimals 6
spl-token --url devnet display TEST_MINT_PUBLIC_ADDRESS
```

The CLI wallet retains mint authority for issuing test balances. Record the
printed mint address; the mint's temporary account signer is not needed for
future minting. In public demonstration copy, label this **Katha Devnet test
token**, with no cash value. The plain classic mint has no on-chain symbol or
display-name metadata added by this command.

The reviewed collection document is [config/devnet/collection.json](../../config/devnet/collection.json).
After it is published to your public GitHub repository, its URI can be:

```text
https://raw.githubusercontent.com/OWNER/REPOSITORY/main/config/devnet/collection.json
```

Replace owner/repository and verify that the URL returns the exact approved JSON
before creating the collection. An immutable commit reference is preferable to
`main` when preserving exact collection metadata bytes. `katha.fun` in the JSON
identifies the project; it does not imply that the domain hosts this demonstration.
The bootstrap screen validates HTTPS and rejects credential/query/fragment URLs;
it does not fetch or certify the collection document's contents.

## Browser bootstrap and read-only plan

Start a separate web process configured for Devnet. Stop a conflicting web
process first. Root `.env` is not automatically loaded by `next dev`; pass these
public settings explicitly:

```bash
KATHA_CLUSTER=devnet KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com \
  pnpm --filter @katha/web dev
```

Open `http://localhost:3000/admin/devnet`. Its controls are disabled when the web
process is configured for localnet. This utility connects its own Wallet Standard
operator wallet; header sign-in and API allowlists do not grant bootstrap powers.
Select the intended wallet and account. Fund that public operator with test SOL.

1. Copy [bootstrap.example.json](../../config/devnet/bootstrap.example.json) into
   the form and replace every placeholder. Use public addresses only. Set the
   approved collection URI and test mint. Registration, verifier, custody and
   treasury wallets may differ from the bootstrap operator.
2. Choose **Generate temporary Devnet collection address**. This fills the
   operator and a fresh collection public address. The collection signer lives
   only in this tab; it is never exported, persisted or sent to the API. Copy the
   completed public JSON to an ignored local file before proceeding:

   ```bash
   mkdir -p helper/devnet
   cp config/devnet/bootstrap.example.json helper/devnet/bootstrap.json
   # Edit this local template to match the completed browser public JSON.
   pnpm devnet:plan helper/devnet/bootstrap.json
   ```

   The read-only command validates the schema, derives canonical PDAs and prints
   the pinned program IDs, binary lengths/SHA-256 hashes and bootstrap order.
   It reads the public JSON and built `.so` files only. It makes no RPC calls,
   verifies no deployment and performs no signing or sending.

3. Select **collection**, then **Prepare and simulate**. Review the public
   operation, authorities, signer addresses, transaction version, estimated
   network fee and rent notice. A successful simulation is a prerequisite, not a
   guarantee of finalization. Confirm the review, then separately choose
   **Approve in wallet**. Save its signature and check until finalized.
4. After finalization choose **Start next operation**, then **registry**. Review
   and approve again. Registry validates the deployed upgrade authority and a
   fresh Core collection controlled by its collection-authority PDA.
5. Repeat for **marketplace**. Its copied Registry settings and classic mint must
   match. Simulation defaults are 250 commission basis points, 500 secondary
   royalty basis points and 2,592,000 seconds of inspection validity (30 days).
   These are development settings, not production promises.

The browser verifies Devnet's genesis hash, canonical public accounts, owners,
program authority relationships and existing configuration. It rejects duplicate
initialization. Before approval it refetches prerequisites, checks blockhash
expiry and simulates again. It verifies all returned signatures over the exact
reviewed message before broadcast, with preflight enabled.

Preparation estimates compute use through Kit, adds a 10% margin (capped at the
network limit), and simulates the final message again. Version 0 includes an
explicit zero compute-unit price for this Devnet utility; version 1 uses its
resource configuration and zero priority fee. These settings appear in the review.
This avoids leaving fee instructions for the wallet to insert. Wallet changes to
the reviewed message, including fee changes, remain rejected before submission.

Wallet approval and each RPC request have separate 20-second timeouts. Signing errors show a fixed application diagnostic without
exposing arbitrary wallet or RPC error details. An expired unsigned review must
be discarded and prepared again. A retained signature must be reconciled before
any retry, even if approval or submission reports an error.

Both program configurations are singletons with no update/close instruction in
this MVP. Review authorities, collection, treasury and mint carefully before
initialization. Reinitialization does not reset a deployment.

## Configure the application and worker

Update the ignored root `.env`, preserving your database and storage settings:

```dotenv
KATHA_CLUSTER=devnet
KATHA_ADMIN_WALLETS=REGISTRATION_AND_CUSTODY_PUBLIC_WALLETS_COMMA_SEPARATED
KATHA_VERIFIER_WALLETS=VERIFIER_PUBLIC_WALLETS_COMMA_SEPARATED
KATHA_RPC_URL=https://api.devnet.solana.com
KATHA_RPC_SUBSCRIPTIONS_URL=wss://api.devnet.solana.com
KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
KATHA_PUBLIC_APP_ORIGIN=http://localhost:3000
KATHA_PUBLIC_API_ORIGIN=http://localhost:3001
```

Replace placeholders with the exact authorized addresses. API roles are an
additional access boundary; they do not substitute for the on-chain signer.
Restart the API, worker and web with matching cluster settings. Never mix localnet
and Devnet projections in the same demonstration database: select a fresh
database using the [database setup](database-package.md) and migrations rather
than deleting an existing database. Both default RPC endpoints are public and
rate-limited; custom browser RPC URLs must contain no credentials.

```bash
pnpm db:start
pnpm db:migrate
pnpm --filter @katha/api dev
# Separate terminal, same ignored root .env:
pnpm indexer:run D2zNLnTqoFZPSCqVLiQAPMXbeoNoLABkh3t6jjoMBUUi 509937161
# Separate terminal, explicit public web configuration:
KATHA_CLUSTER=devnet KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com \
  pnpm --filter @katha/web dev
```

The API and indexer load root `.env` through their package commands. Media and
private fulfillment details stay in configured local storage/database; they do
not become public merely because the programs use Devnet. Public metadata URIs
must be reachable by intended demonstration viewers. See
[storage](local-storage.md) and [indexer operation](chain-activity-ingestion.md).

The worker start above includes the verified Registry initialization. Confirm RPC
history is retained through the first artwork registration; follow the indexer
guide for gaps/backfill rather than advancing the start to hide missing activity.
For the complete operator/collector/phone sequence, use the
[two-wallet and NFC demonstration guide](devnet-demo.md). Its manual checkpoints
remain pending until performed.

## Per-artwork payout binding and collector balances

After artist onboarding and on-chain artwork registration, use **sale-terms**
in `/admin/devnet`. Enter the exact permanent Katha ID and the artist-approved
public payout wallet. Check the artist's database identity and authorization
manually before approval: the chain cannot establish that a wallet belongs to
the physical artist. This binding is immutable and distinct from the artwork's
optional creator wallet, artist authorship and current Core owner. It is required
before listing an artwork. No API bearer session is used by this utility.

Fund collector test SOL and classic token accounts using the CLI wallet that
holds the test mint authority. Replace all placeholders, record the created token
account, then mint into that exact account:

```bash
solana --url devnet airdrop 2 COLLECTOR_PUBLIC_ADDRESS
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  create-account TEST_MINT_PUBLIC_ADDRESS --owner COLLECTOR_PUBLIC_ADDRESS
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  mint TEST_MINT_PUBLIC_ADDRESS 1000 COLLECTOR_TOKEN_ACCOUNT_PUBLIC_ADDRESS
spl-token --url devnet balance TEST_MINT_PUBLIC_ADDRESS --owner COLLECTOR_PUBLIC_ADDRESS
```

The CLI amount `1000` is 1,000 whole test tokens. Katha API JSON uses integer
base-unit decimal strings: with six decimals this balance is `"1000000000"`.
Collectors approve their own purchases; funding does not authorize settlement.

## Recovery and verification boundary

After signing, save the retained public signature **before leaving the tab**.
The bootstrap screen keeps receipts and the temporary collection signer only in
memory. Reloading is not durable recovery. A timeout or absent signature status
is **UNKNOWN**, not proof of failure. Check that same signature, for example:

```bash
solana --url devnet confirm --verbose TRANSACTION_SIGNATURE
```

Do not submit a replacement while the signed transaction can still land. If it
expires without a recorded receipt, inspect the exact destination accounts at
finalized commitment before preparing another operation. Existing accounts are
rejected rather than silently adopted. If collection creation finalized, keep its
public address: subsequent initialization does not require its temporary signer.
If it never signed and the tab closed, generate a new collection address. An
already signed but uncertain collection transaction must be reconciled first.

Automated checks cover public-input validation, authority/account substitutions,
duplicate initialization, invalid mints, separate approval, expiry, signature and
message integrity, and ambiguous broadcast handling. They use synthetic accounts
and temporary test identities. This preparation is not an actual Devnet
deployment or a successful two-wallet/NFC demonstration. Those receipts and the
manual acceptance journey are separate completion gates.

Sources: [Solana program deployment](https://solana.com/docs/programs/deploying),
[Metaplex Core collections](https://www.metaplex.com/docs/smart-contracts/core/collections),
[Registry bootstrap](registry-bootstrap.md),
[Marketplace configuration](marketplace-configuration.md).
