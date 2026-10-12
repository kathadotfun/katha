# Two-wallet and NFC Devnet demonstration

**Status: guide prepared; manual demonstration pending.** The programs,
collection and configurations were verified in [the network snapshot](devnet-network.md).
No real artwork onboarding, purchase, physical delivery, inspection or NFC tap
is claimed by this guide. Automated fixtures do not complete these checkpoints.

Use this sequence to document a physical Nepali artwork, purchase it as Collector
A, inspect it for resale, and purchase it as Collector B. Preserve the same artist,
Katha ID and Core asset throughout. Payments are Devnet test tokens with no cash
value. Physical authentication and fulfillment are operator actions.

## 1. Prepare people, artwork and a private run record

| Role               | Required access / responsibility                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator           | Admin/verifier API allowlists and matching Registry authorities; signs registration, verification, metadata, condition, custody and minting |
| Artist             | Approves attribution, cultural descriptions, public photographs and the payout wallet; creator wallet is optional                           |
| Collector A        | Separate Wallet Standard account; purchases first and requests delivery/inspection when applicable                                          |
| Collector B        | A different account from A and the operator; purchases the resale                                                                           |
| Physical inspector | Actually inspects the work; authorized verifier records that claim                                                                          |

The current operator is
`DKiWVyP2QHs16f5mncnG3QHJLXev8qPnYKzqP6qmfFHR`. Use separate browser profiles for
the operator, A and B. Both collectors must also differ from the artist payout wallet and treasury; a
buyer cannot pay into its own payout account. Verify the displayed account and
approving wallet each time.
Never transfer a seed phrase or keypair between profiles. Connection is not sign-in;
message sign-in is not transaction approval.

Prepare an artwork you may document, approved photographs, actual authorship
evidence, a writable NFC tag and a compatible phone. Use accurate materials,
dimensions and cultural context; do not invent artist approval or sacred meanings.
Select the final demo origins before preparing immutable documents.

Create a private run record outside public Git (for example under ignored
`helper/`). Retain the artist UUID, permanent Katha ID, draft creation UUID,
authorship digest, metadata/report UUIDs and hashes, Core address, tag UUID,
wallet public addresses, listing revisions, transaction signatures and finalized
slots. Keep evidence, contacts and shipping details private. Do not export session
tokens, authenticated requests or signing material into that record.

If using fictional fixtures first, label them synthetic and record a separate
rehearsal. That is not the real-artwork acceptance run. Never re-register the same
physical work as a new identity to reset history.

## 2. Configure services before creating documents

Use the [pinned setup](getting-started.md), existing migrations and ignored root
`.env`. Preserve existing environment settings; do not overwrite the file with
the example. Use a fresh database for this deployment's first run rather than
mixing earlier localnet projections with Devnet. If needed, create a new database
without deleting the existing volume:

```bash
pnpm db:start
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" katha_devnet_demo'
```

Choose an unused database name. Update only the database component of the ignored
`DATABASE_URL` to that name, preserving its actual credentials and percent encoding.
Changing Compose initialization variables does not change an existing volume's
user/password. After registering artwork, preserve this database, its ID counters
and storage; starting empty again can collide with existing on-chain artwork IDs.

Use Devnet and the role address from section 1 in the existing allowlists:

```dotenv
KATHA_CLUSTER=devnet
KATHA_ADMIN_WALLETS=DKiWVyP2QHs16f5mncnG3QHJLXev8qPnYKzqP6qmfFHR
KATHA_VERIFIER_WALLETS=DKiWVyP2QHs16f5mncnG3QHJLXev8qPnYKzqP6qmfFHR
KATHA_RPC_URL=https://api.devnet.solana.com
KATHA_RPC_SUBSCRIPTIONS_URL=wss://api.devnet.solana.com
KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
KATHA_PUBLIC_APP_ORIGIN=http://localhost:3000
KATHA_PUBLIC_API_ORIGIN=http://localhost:3001
```

For a laptop rehearsal, use localhost. For an actual phone tap, both API and web
origins must be reachable from the phone; `localhost` on the phone is the phone.
Follow [LAN configuration and tag writing](nfc-tag-writing.md) **before** preparing
metadata. API, web, CORS and sign-in origins must agree. Operator wallet signing
needs a browser/wallet context that supports the required cryptography; public
HTTP LAN viewing alone does not establish wallet compatibility. Verify connection
and sign-in in the chosen context before proceeding. Stop if the required context
is unavailable; this guide does not provision HTTPS hosting or TLS infrastructure.

Apply migrations and build packages:

```bash
pnpm db:migrate
pnpm build
pnpm devnet:test
```

Run the API in one terminal:

```bash
pnpm --filter @katha/api dev
```

Run the web in another, passing the selected public origins explicitly. Next.js
does not load the root `.env` through the API command. For localhost:

```bash
KATHA_CLUSTER=devnet \
KATHA_PUBLIC_APP_ORIGIN=http://localhost:3000 \
KATHA_PUBLIC_API_ORIGIN=http://localhost:3001 \
KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com \
pnpm --filter @katha/web exec next dev --hostname 127.0.0.1 --port 3000
```

Use the LAN origins and a reachable listen address for a phone run. Resolve occupied
ports rather than silently changing the configured origins. Check `/health/live`
and `/health/ready` on the API; readiness proves database availability, not chain
or indexer readiness. The account page must display **Devnet**.

Start the worker in a third terminal with collection **and start slot**:

```bash
pnpm indexer:run D2zNLnTqoFZPSCqVLiQAPMXbeoNoLABkh3t6jjoMBUUi 509937161
```

That start is the verified Registry initialization slot, before this deployment's
artwork registration. The RPC must retain the needed history. Alternatively,
record a finalized slot before the first registration in a genuinely fresh run
and use it consistently. Never move the start forward to hide a gap or change it
after acknowledgement. Follow [backfill and recovery](chain-activity-ingestion.md#run-backfill-and-inspect-recovery)
for page limits, pruned history or missing activity. Public RPC is rate-limited;
the worker must report gaps rather than invent completeness.

Do not deploy programs, create another collection or initialize singleton
configurations again. `/admin/devnet` will be used only for per-artwork sale terms.

## 3. Prepare payment accounts and fund collectors

Give both collectors test SOL for network fees/rent and the configured test token:
`21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam`. Confirm the CLI wallet is its mint
authority from the network manifest before minting. Program upgrade authority and
token mint authority are different; the Phantom operator does not automatically
have this mint authority.

The following are **operator commands**, with public placeholders replaced:

```bash
solana --url devnet address
solana --url devnet balance
solana --url devnet airdrop 2 COLLECTOR_PUBLIC_ADDRESS
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  create-account 21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam --owner COLLECTOR_PUBLIC_ADDRESS
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  mint 21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam 1000 COLLECTOR_TOKEN_ACCOUNT_ADDRESS
spl-token --url devnet balance 21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam --owner COLLECTOR_PUBLIC_ADDRESS
```

Repeat for A and B. If a token account exists, inspect/reuse it; do not substitute
an unrelated account. Faucet limits may require waiting. `1000` above means 1,000
whole test tokens. API amounts are base-unit decimal strings: a price of `120`
tokens is `"120000000"`. SOL is not the artwork payment currency.

Before listing, create or verify the canonical associated token account for each
unique recipient: the artist-approved payout wallet, treasury and initial seller
(the operator for this deployment). The purchase transaction does not create
these accounts, and validates every destination even when its share is zero.
Collector A's account becomes the seller destination for resale.

```bash
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  create-account 21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam --owner APPROVED_ARTIST_PAYOUT_ADDRESS
spl-token --url devnet --program-id TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
  create-account 21f6RVabPpfoLipUf75tNjpdfRQupKXKgkPGdST8ZGam --owner DKiWVyP2QHs16f5mncnG3QHJLXev8qPnYKzqP6qmfFHR
```

Reuse an existing canonical account rather than creating another. Shared recipient
roles reuse the same account; the operator is also this deployment's treasury.
Recipients need valid accounts, not preloaded payment balances. Confirm the mint,
owner and canonical address of every account before preparing a purchase.

## 4. Document the artist and artwork

1. Operator opens `/account`, connects the expected wallet and signs in. Read the
   challenge domain, Devnet cluster and account. If another extension prompts,
   cancel and resolve wallet selection. The session lives only in the open tab:
   move between pages with the header and page links. Typing a URL or reloading
   starts signed out; use the page's **Sign in** link, sign in again, then
   **Continue where you left off**.
2. Open `/admin`. Create an artist with approved name, slug, biography, region,
   traditions and links. Save its record ID. Creator wallet may be absent; set the
   artist-approved payout wallet for sales.
3. Look up and manually verify the artist after the actual review. This is an API/
   database action, not the Registry artwork verification transaction.
4. Open `/admin/artworks/new`. Retain the creation UUID before saving. Enter the
   artist record ID, tradition, year, title, dimensions in millimetres, materials,
   technique, origin, story, meaning, context and process. Compute the lowercase
   SHA-256 of the exact approved authorship evidence bytes locally, for example
   `sha256sum /path/to/private/evidence-file`. Keep those bytes outside Git.
5. Save once and record the returned permanent Katha ID. Never assume a counter
   or use a title slug as the identity. Reload `/admin/artworks/{id}` and compare
   saved values with the physical object.
6. Open `/admin/artworks/{id}/media`. Upload approved files, select roles/order and
   explicitly approve PUBLIC copies, including a HERO image. Keep condition
   evidence private. Finish these edits before the next checkpoint.

These actions save local records/files. No Core asset or sale exists yet. Public
artwork discovery remains hidden until publication; approved public file bytes can
be accessible before catalogue publication. Public approval is therefore a real
disclosure decision. See [media administration](artwork-media-administration.md).

## 5. Register, authenticate and commit metadata

For every chain action: reload saved state, prepare and simulate, review network,
signer, accounts, exact facts and fee/rent, explicitly approve in the correct
wallet, retain the signature, check finalized success, then wait for matching
indexing. UNKNOWN is not failure or permission to send a replacement.

1. `/admin/artworks/{id}/registration`: prepare canonical metadata and review its
   exact bytes, SHA-256, attribution and media references. This creates public
   JSON and closes draft/media editing; it is not on-chain metadata commitment.
2. Confirm that review, then prepare/sign registration. Expect the immutable ID,
   artist/category/year/evidence commitment to be registered. Registration does
   not verify, mint, publish or change custody.
3. `/admin/artworks/{id}/verification`: physically compare the artwork/evidence,
   confirm authorship and approve the authorized authentication attestation.
4. `/admin/artworks/{id}/metadata`: initialize the on-chain metadata commitment
   using the saved document. Confirm finalized version, hash and URI. Preparing
   JSON alone did not write this commitment.

Inspect [registration](artwork-registration-web.md),
[verification](artwork-verification-web.md) and
[metadata contracts](metadata-revisions-api.md) if a gate fails. Never edit the
database or generated clients to bypass a prerequisite.

## 6. Inspect, record custody, mint and publish

1. `/admin/artworks/{id}/condition`: enter actual grade/time, INITIAL_VERIFICATION,
   inspector UUID, private notes and private evidence. Save the immutable report;
   record its UUID/hash. Review and sign its attestation as verifier. Initial
   unminted reports have no minted owner/custody scope.
2. `/admin/artworks/{id}/custody`: when the artwork is actually held by Katha,
   attest Katha custody from UNKNOWN. Confirm finalized KATHA_HELD and the custody
   revision. Do not claim possession merely to unlock a button.
3. `/admin/artworks/{id}/minting`: reload verified registration, authentication,
   metadata, initial condition and held custody. Review the derived Core address,
   collection and URI; explicitly prepare/sign minting. Record asset/signature.
   Core's initial owner is the registration authority, not automatically the artist.
4. Wait for finalized receipt and matching indexing. Confirm one bound Core asset
   and unchanged artist/ID/custody. Minting does not publish or list the work.
5. Review publication separately and choose **Publish artwork**. This is a
   database action; it requires the matching finalized/indexed prerequisites.
6. Signed out, visit `/art/{id}`, `/explore`, `/artists/{slug}` and `/`. Check
   photography, artist, cultural content, authenticity, condition, custody,
   provenance, document integrity and links to Devnet evidence. No private notes,
   inspection photos or delivery contacts should appear.

Use [inspection](condition-inspection-web.md),
[custody](custody-administration-web.md) and [minting](minting-administration-web.md).
If testing a metadata revision, use `/admin/artworks/{id}/metadata`; save approved
story changes and finalize the atomic Core URI/Registry commitment revision.
Earlier commitments and attribution must remain preserved.

## 7. Assign, write and retest NFC

Assign the tag after publication and before the first purchase to check stability
across both sales. Return to this checkpoint after each ownership change.

Assign tags from the **NFC tag** panel at the bottom of the artwork's
documentation page (`/admin/artworks/{id}`): enter a new lowercase UUID as the tag
reference and choose **Assign tag**. **Look up binding** reads an existing tag,
and the panel offers retirement with a confirmation. The API has no "list this
artwork's tags" read, so the panel shows tags assigned or looked up in the current
session. The underlying operations are:

```text
POST /admin/artworks/{id}/nfc-tags        {"tagId":"<new-lowercase-uuid>"}
GET  /admin/nfc-tags/{tagId}
POST /admin/nfc-tags/{tagId}/retire       {}
```

1. Generate and retain one tag UUID. Confirm ACTIVE and the intended Katha ID.
2. An anonymous GET to `<api-origin>/nfc/{tagId}` must return 302 with Location
   `<web-origin>/art/{same-id}?source=nfc` and no-store. Unknown tag: 404; published retired
   tag: 410. Do not assign a query-string redirect override.
3. On the phone, first open both origins and the resolver URL manually. Write one
   NDEF URI record containing the **API resolver URL**, not the direct artwork URL.
   Read the tag back and compare its exact URL, then tap and inspect the artwork.
4. Repeat the tap after A's purchase and B's resale. The same tag must open the
   same artwork ID while recorded Core ownership changes and attribution remains.
5. Test retirement/replacement only deliberately: POST
   `/admin/nfc-tags/{tagId}/retire` with `{}`, verify 410, then assign/write a new
   UUID for the same artwork. Old IDs cannot reactivate or remap. Record which
   physical tag is active and read back the replacement.

The artwork page must explain that basic NFC can be copied. Tag UUID is not chip
UID. A scan locates a record; it proves neither physical authenticity nor delivery.
`katha.fun` ownership alone does not provide hosted resolver routing.
See [NFC contracts](nfc-administration.md) and [hardware instructions](nfc-tag-writing.md).

## 8. Bind the approved payout and make a primary offer

1. In `/admin/devnet`, connect its separate operator wallet. Paste the manifest's
   `bootstrapInputs`, select **sale-terms**, and enter the actual Katha ID and
   artist-approved payout. Review, simulate and sign. The binding is immutable;
   a profile payout field alone did not initialize it on-chain. Do not select
   collection/registry/marketplace initialization again.
2. Sign in as initial Core owner; open `/collection/{id}/list`. Enter a price
   such as `120` whole test tokens and a comfortable future expiry.
3. Refresh eligibility and review primary type, exact mint/base units, revision,
   expiry and accounts. Prepare, sign and finalize the listing.
4. Expect ACTIVE and temporary Core delegate locking. Core owner remains the
   seller, artist remains the author, and physical custody remains KATHA_HELD.

Optional cancellation rehearsal: cancel a listing as seller and verify unlock/no
sale, then make a new offer. Expiry alone does not unlock the asset; the browser's
**Release expired listing** uses seller cancellation and records CANCELLED.
The program's separate permissionless expiry instruction is not that browser flow.

## 9. Collector A makes the first purchase

1. In A's profile, sign in and open `/art/{id}/purchase`.
2. Refresh the quote. Check seller, mint, listing revision, price, expiry, custody
   and recipients. At 120 tokens with this configuration, primary proceeds are
   117 artist / 3 treasury, excluding network fees and rent.
3. Prepare the reviewed purchase and approve as A. Retain the signature and wait
   for finalized success and Core owner A; then wait for indexed sale/transfer.
4. Refresh A's `/collection` and the former seller's collection. Public artwork
   identity/artist remain unchanged. Custody remains KATHA_HELD; purchase did not
   deliver the painting. Payments and Core transfer settled atomically.

See [purchase workflow](purchase-web.md). Preparation reserves neither quote nor
asset; execution must recheck eligibility. Recipient overlap merges payouts,
so inspect the actual quote/balance deltas rather than assuming distinct accounts.

## 10. Collector-held inspection and resale to B

Use actual physical actions for the real run. Fictional delivery details and
simulated movement belong to a separately labeled rehearsal.

1. A opens `/collection/{id}/delivery` and sends a private delivery request. Save
   its UUID. This neither moves custody nor makes a wallet transaction.
2. Operator uses `/admin/artworks/{id}/custody` to approve the request. Once
   physical dispatch occurs, sign/finalize the eligible transition to IN_TRANSIT,
   then separately save the request as DISPATCHED. Set private tracking details
   before dispatch closes their edit window.
3. After actual receipt, A chooses **I've received the painting** on the delivery
   page. This private collector claim does not itself attest Registry custody.
4. Operator verifies receipt, signs/finalizes COLLECTOR_HELD with A as custodian,
   then separately saves request status RECEIVED. Core owner stays A throughout.
5. A opens `/collection/{id}/resale`, refreshes and requests inspection. A's
   initial or POST_DELIVERY report does not authorize this secondary sale.
6. Verifier opens `/admin/artworks/{id}/condition`, reviews the resale request,
   physically inspects, and saves a PRE_RESALE report with actual time/grade and
   private evidence. Check its scope is current Core owner A/current custody
   revision. Sign and wait for finalized attestation; refresh until APPROVED.
7. A opens `/collection/{id}/list` and signs an eligible secondary listing.
8. B signs in, reviews `/art/{id}/purchase`, and purchases. For 120 tokens,
   secondary proceeds are 111 seller / 6 artist / 3 treasury, excluding fee/rent.
9. Verify finalized Core owner B, indexed sale, A's collection removal and B's
   inclusion. Preserve primary sale, both inspections, metadata versions and artist.
   Physical custody does not automatically change from A to B; coordinate actual
   delivery with the allowed separate custody actions.

Inspection validity is 30 days from inspection time, not request time. Stale
owner/custody scope, expired inspection or transit blocks eligibility at listing
and purchase. Requests are private coordination; approval is derived from the
finalized attestation. See [delivery](delivery-web.md) and
[inspection/resale](resale-inspection-web.md).

## 11. Verify the retained-custody resale situation separately

Use another physical work with its own ID, repeat onboarding/primary purchase,
and keep it continuously in Katha custody. A may then make an eligible secondary
offer and B purchase without physical dispatch. Verify owner B while custody
remains KATHA_HELD. NOT_REQUIRED means the existing continuous-custody condition
rules were satisfied, not that all artwork verification was bypassed.

With only one physical work, run retained-custody A → B resale **before** delivery.
Then continue section 10 with current owner B and resale buyer A for a third sale.
Keep all history; do not remint/reset the work. Record which wallet performed
each role. Dispatch/return changes custody revision; returning to Katha does not
automatically revive an old unscoped condition report.

## 12. Check storage, failures and finish evidence

| Information                                               | Actual persistence                                                                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Photographs/video and canonical JSON                      | Content-addressed API `.storage/private/` or explicitly approved `.storage/public/`; media/document reference rows in PostgreSQL  |
| Public photo delivery                                     | Approved `/storage/public/{hash}.{extension}` API reference; file bytes are not on Solana                                         |
| Artist/story/materials and drafts                         | PostgreSQL and public canonical metadata, with private/public projections                                                         |
| Authorship, verification, condition, metadata and custody | Bounded Registry records, hashes, identities, versions, times and events; detailed report/evidence bytes remain private off-chain |
| Core asset                                                | Current digital owner, collection and metadata URI; one asset bound to the registered work                                        |
| Listing/payment/sale                                      | Marketplace accounts and successful events plus token balance changes and Core transfer                                           |
| Provenance/holdings                                       | Finalized Registry/Marketplace/Core observations indexed into PostgreSQL; not an ownership array in an artwork account            |
| NFC assignment/retirement                                 | PostgreSQL binding/history; tag contains the public resolver URL; no NFC transaction on Solana                                    |
| Sessions/shipping/inspection requests                     | Private database records; no session token, address or contact in public metadata/provenance                                      |

Default storage is `apps/api/.storage/` when using the API package command. An
explicit server-only storage override can change it. There is no configured remote
archival storage provider; back up database and storage together privately.
See [storage behavior](local-storage.md) and [document preparation](document-preparation.md).

Test cancellation, rejected approval, invalid price and wrong-wallet access using
the existing controls. Verify no successful sale/provenance is created by a failed
transaction. Do not manufacture wrong accounts, tamper with real evidence, change
system time or delete history to force failures. Use the existing synthetic program
and browser harnesses for races, rounding, account forgery and inspection expiry.

For UNKNOWN results, keep the same signature and check again; never blindly replace
it. A finalized receipt and indexed history are different milestones. If indexing
lags or reports gaps, recover the worker and reload the saved receipt. If signed
message bytes changed, stop and diagnose rather than weakening validation.

Finish only when the private run record confirms:

- [ ] Actual artist approval, physical authentication and inspections completed.
- [ ] Permanent ID, attribution and one Core asset preserved throughout.
- [ ] A primary purchase and inspected secondary purchase finalized with correct payouts.
- [ ] Core current owner and indexed provenance/collections agree without duplicate sales.
- [ ] Retained and collector-held custody scenarios verified independently.
- [ ] Shipping details, condition evidence and sessions remain private.
- [ ] Actual NDEF read-back and phone taps before/after sales open the same identity.
- [ ] Metadata integrity, earlier reports/versions and indexing health checked.
- [ ] Any missing checkpoint remains pending; screenshots/fixtures are not substituted for it.

Keep completed records, media, wallet/network exports and physical evidence outside
public Git. Publish only an explicitly reviewed verification summary after the
actual run. This unchecked guide is not that summary.
