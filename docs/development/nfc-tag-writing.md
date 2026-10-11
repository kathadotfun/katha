# Write and verify a Katha NFC tag

This guide is for a local or LAN demonstration using an artwork and writable NFC
tag you provide. Katha stores a public tag UUID bound to a permanent artwork ID.
The physical tag stores a URL that opens that record. Writing, attachment and
physical inspection are manual; the website does not write NFC hardware.

## Choose the URL

Write **one NDEF URI/URL record** containing the complete resolver URL:

```text
<reachable-api-origin>/nfc/<assigned-lowercase-uuid>
```

Use the resolver URL rather than the final `/art/<kathaId>` URL on the tag. The
resolver checks the binding and retirement state on each request. Writing the
artwork URL directly bypasses retirement checks. The UUID is a public reference,
not a secret, chip UID, artist ID, asset address or proof of authenticity. Do not
include a wallet session token, private evidence, shipping data or redirect query.

The resolver lives on the API, not the Next.js web server. It returns a temporary
302 to the configured web origin's permanent `/art/<kathaId>` route. There is no
Next.js `/nfc` proxy or hosted domain routing provisioned by this project.

| Demo                  | URL written to tag                    | Expected redirect                        |
| --------------------- | ------------------------------------- | ---------------------------------------- |
| Same laptop           | `http://localhost:3001/nfc/<uuid>`    | `http://localhost:3000/art/<kathaId>`    |
| Phone on the same LAN | `http://192.168.1.87:3001/nfc/<uuid>` | `http://192.168.1.87:3000/art/<kathaId>` |

The LAN address above is an example. Substitute the laptop's current reachable
address; do not assume it stays unchanged. A phone's `localhost` refers to the
phone, so a localhost tag cannot reach laptop services. A tag written for a
changing LAN address must be rewritten when that address changes. The permanent
Katha identity remains unchanged.

`katha.fun` is the owned canonical public domain. Do not write
`https://katha.fun/nfc/<uuid>` for this demo unless you have separately configured
and verified hosted routing to the API and the artwork page. Selecting that domain
in environment configuration does not deploy it. Hosted setup is outside this guide.

## Prepare the services and assignment

1. Complete the documented [local setup](local-services.md). Apply existing
   migrations with `pnpm db:migrate` using your ignored root `.env`. The NFC table
   was introduced in `0012_nfc_tags.sql`; this guide adds no migration.
2. Have an eligible published artwork: the artist is verified, authorship is
   committed, verification/metadata/initial condition are finalized and Core
   ownership is indexed on the configured localnet or Devnet cluster. A tag can be
   assigned to a draft, but it returns 404 publicly until eligible.
3. Authenticate the configured admin wallet through the existing
   [wallet authentication](wallet-authentication.md) and
   [authorization](api-authorization.md) boundaries. The collector wallet alone
   does not grant tag administration. Wallet sign-in is available at `/account`;
   NFC administration still uses authenticated API operations.
4. Generate a new lowercase UUID once, retain it for retries, and use
   `POST /admin/artworks/<kathaId>/nfc-tags` with JSON `{ "tagId": "<uuid>" }`.
   Inspect `GET /admin/nfc-tags/<uuid>` and confirm the intended permanent Katha ID
   and `ACTIVE` state. See [administration contracts](nfc-administration.md).
5. Check resolution in a browser before writing hardware. A known published active
   tag must open the expected artwork. Check the permanent ID, artist and recorded
   inspection on the page; a working URL is not a physical authenticity check.

For localhost, keep the default origins and run the API and web in separate
terminals:

```bash
pnpm --filter @katha/api dev
```

```bash
pnpm --filter @katha/web dev
```

For a phone demo, put these public settings in the ignored root `.env`, replacing
both occurrences of the example address. Keep the configured database, cluster,
role allowlists and other server settings:

```dotenv
API_HOST=0.0.0.0
API_PORT=3001
KATHA_PUBLIC_APP_ORIGIN=http://192.168.1.87:3000
KATHA_PUBLIC_API_ORIGIN=http://192.168.1.87:3001
```

Restart the API with `pnpm --filter @katha/api dev`. Next.js does not load the root
`.env` through the API's startup command; explicitly supply matching public
origins and cluster. For the configured Devnet demonstration:

```bash
KATHA_CLUSTER=devnet \
KATHA_PUBLIC_APP_ORIGIN=http://192.168.1.87:3000 \
KATHA_PUBLIC_API_ORIGIN=http://192.168.1.87:3001 \
KATHA_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com \
pnpm --filter @katha/web exec next dev --hostname 0.0.0.0 --port 3000
```

Use a trusted local network. Both ports must be reachable from the phone; check
Wi-Fi client isolation and local firewall settings if the browser cannot connect.
Keep PostgreSQL and Solana RPC private; they do not need exposure to the phone.
Open the web page and resolver URL directly on the phone before testing a tap.
These HTTP demo URLs are not production hosting or wallet-security settings.
Verify the operator's browser/wallet cryptography and sign-in support before
creating immutable documents for these origins. A phone's successful public HTTP
page load is not proof that wallet signing works in that browser context. See the
[complete Devnet demonstration](devnet-demo.md) for the pending manual checkpoints.

Inspect the redirect without following it, using an actually assigned UUID:

```bash
curl --head 'http://192.168.1.87:3001/nfc/<uuid>'
```

Expect 302, `Location: http://192.168.1.87:3000/art/<kathaId>` and
`Cache-Control: no-store`. Then open that location on the phone. Unknown/private
bindings return 404, public retired tags 410 and malformed identifiers/extra queries 400. Failures have no Location header; never work around them by writing another
artwork's URL.

## Write, read back and attach

1. Use an NFC-capable phone or reader and a writable, NDEF-compatible tag. Check
   that the writer can encode the complete URL within the tag's capacity. Do not
   overwrite an existing installation without checking its assignment.
2. In your NFC writer, select a **URL/URI record**, not a plain-text record. Enter
   the complete verified API resolver URL with its `http://` or `https://` scheme.
   Write one URI record; let the writer encode the NDEF URI payload. Do not write
   JSON, the UUID alone, the final redirected URL or an Android app-launch record.
3. Hold the tag near the reader until the writer reports completion. Read it back
   with the writer and compare the decoded URL byte-for-byte with the intended URL.
4. Use the phone's supported NFC reading flow, opening any link notification if
   shown. NFC support and background behavior vary by device and OS; use the
   reader app if the phone does not offer background URL reading. Check the resulting
   permanent Katha ID and artwork page on the actual test phone.
5. Record the binding and physical placement in your private operational records.
   Attach it to the intended work only after checking the artist, public photographs,
   documented physical features and manual inspection record. Re-test after attachment.
   Do not publish placement evidence or personal details in Git.
6. Leave demo tags writable while testing. If you later choose irreversible
   read-only locking, check the writer/tag documentation and complete read-back
   verification first. Locking prevents rewriting that tag; it does not prevent
   cloning or independently authenticate the object.

NDEF URI handling is described in the official
[Android NFC basics](https://developer.android.com/develop/connectivity/nfc/nfc)
and [URI record API](<https://developer.android.com/reference/android/nfc/NdefRecord#createUri(java.lang.String)>).
For supported Apple devices, consult
[background tag reading](https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading).
A notification or app selection may require a separate user action; do not assume
every phone automatically opens a page after a tap.

## Retirement, replacement and manual acceptance

Retire a lost or replaced tag using `POST /admin/nfc-tags/<old-uuid>/retire` with
JSON `{}` under the admin session. Retirement is terminal and idempotent. Assign a
**new UUID** to the same permanent artwork, then write/read back the new resolver
URL. Retired IDs cannot reactivate or bind to another artwork. These are separate
operations, so a failed new assignment can leave no active tag temporarily.

For a publicly eligible artwork, the old resolver must keep returning 410 without
a redirect, while the new resolver returns 302 to the same permanent artwork URL.
The artwork page itself stays available. A direct artwork URL, already opened page
or copied photograph is not revoked by tag retirement. Losing a tag does not
transfer digital ownership, change custody or invalidate an inspection record.

Complete this manual checklist with the actual artwork and phone; automated test
success does not certify that hardware has been written or physically inspected:

- [ ] Assigned UUID and permanent Katha ID checked under admin access.
- [ ] Actual phone reaches both configured API and web origins.
- [ ] NDEF URI read-back equals the intended resolver URL.
- [ ] Tap opens the intended permanent artwork page and NFC limitations are visible.
- [ ] Physical object compared with public documentation and manual inspection.
- [ ] If testing replacement: old URL returns 410, new tag opens the same artwork.
- [ ] After approved owner changes: tag still opens the same permanent identity;
      current recorded owner changes independently from authorship and custody.

Basic NFC is clonable. Successful resolution only locates a public record; it does
not prove authenticity, ownership, physical custody, delivery or resale approval.

## Automated lifecycle coverage

Run `pnpm db:test` for disposable PostgreSQL and API integration tests. The NFC
case uses the real publication predicate and HTTP router: an active tag redirects,
a title update and two synthetic indexed owner changes preserve its destination,
and author attribution, inspection, metadata commitments and custody remain
unchanged. It verifies terminal/idempotent retirement, rejection of retired-ID
reuse, replacement stability, missing tags and public/private eligibility.

These owner changes are synthetic read-model fixtures, not real Core transfers or
marketplace purchases; those complete journeys are verified in later stages.
Existing API tests cover administrative authorization, input validation, unsafe
redirect attempts, unknown/retired responses and sanitization. No hardware writer,
mainnet transaction or hosted service is exercised by these checks.
