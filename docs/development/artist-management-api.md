# Artist creation and manual verification

Artist profiles are manually onboarded application records. The authenticated
operator supplies approved public content; the server assigns the UUID and records
verification separately. Profiles do not require a creator or payout wallet.

## Protected endpoints

| Endpoint                                        | Required role       | Success                      |
| ----------------------------------------------- | ------------------- | ---------------------------- |
| `POST /admin/artists`                           | configured admin    | 201 artist response          |
| `POST /verifier/artists/:artistId/verification` | configured verifier | 200 verified artist response |

Use [signed wallet sessions](wallet-authentication.md) and send the bearer token
in `Authorization`. The [administrative guards](api-authorization.md) authenticate
and authorize before either handler runs. Admin permission does not imply verifier
permission; operators doing both actions must explicitly have both roles.

Both endpoints use `application/json`, strict shared Zod contracts, the existing
body limits, fixed domain errors/request IDs, no-store responses and redacted logs.
Missing/expired/revoked sessions return 401; wallets without the required role
return 403. Input validation failures return 400 and unsupported content type
returns 415. An unexpected database failure returns fixed 500 without driver data.

## Creation

A synthetic request, suitable for disposable tests only:

```json
{
  "slug": "fictional-patan-artist",
  "displayName": "Fictional artist",
  "biography": "Synthetic artist biography for development.",
  "region": "Patan",
  "traditions": ["Paubha"],
  "publicLinks": ["https://example.com/fictional-artist"],
  "profileImageUrl": null,
  "creatorWallet": null,
  "payoutWallet": null
}
```

The slug is unique lowercase ASCII letters/digits separated by single hyphens,
up to 160 characters. Display name, biography and region are nonblank and bounded
by the existing domain contract: 160, 5000 and 120 characters. Traditions require
1–20 nonblank values of up to 120 characters. Ordinary Unicode and biography line
breaks are preserved; NUL and unsupported text controls are rejected.

Public links default to an empty array and allow at most ten HTTP(S) URLs.
Each URL and the optional image URL has a 2048-character limit and must contain
no credentials or whitespace. URLs are stored, not fetched by this endpoint.
Only approved public media/links belong here; never submit private evidence URLs,
access tokens, contact details or personal notes as profile content.

Wallet fields may be omitted or null. Provided addresses must decode to 32 bytes
through the existing Kit validator and cannot be the zero address. Creator and
payout wallets are independent and need not differ. A payout-only profile is
valid. Recording a wallet does not prove artist control of that wallet. Sale
eligibility and payout approval remain separate later workflows.

The server creates `UNVERIFIED` with null verifier/time fields, assigns the UUID
and database creation/update times, and returns the saved record through an explicit
response projection. Request-supplied UUID, verification state, verifier, timestamps,
roles or extra fields are rejected. Duplicate slug creation returns 409, including
concurrent attempts; an existing profile is never updated by a duplicate request.

## Manual approval

After the operator completes artist verification outside the software, send:

```json
{ "confirmed": true }
```

The path uses the artist UUID, not a wallet or public slug. UUIDs are validated and
normalized to lowercase. The request requires explicit `true`; it accepts no
verifier wallet, timestamp, evidence, profile edits or verification status.

One conditional database update changes `UNVERIFIED` to `VERIFIED`, attributes
the claim to the currently authenticated verifier wallet, and sets both verification
and update time to the same database statement time. It preserves all content,
UUID, creator/payout wallets and creation time. A transaction distinguishes missing
artists (404) from already verified profiles (409). Repeated requests and competing
verifiers cannot overwrite the first successful approval or its timestamp.

This is an off-chain artist-profile claim. It neither verifies an artwork nor
creates an on-chain event, and it needs no initialized Registry or RPC call.
Future artwork verification requires its own exact Registry authority check and
wallet-approved transaction. No private evidence upload or verification history
endpoint is included here.

## Response contract

`artistResponseSchema` contains the creation fields plus:

- server `id` UUID;
- `verificationStatus`: `UNVERIFIED` or `VERIFIED`;
- nullable `verifiedByWallet` and ISO UTC `verifiedAt`;
- ISO UTC `createdAt` and `updatedAt`.

Optional wallet/image fields are always explicit nulls when absent. Responses
include only the approved profile fields; future private persistence columns are
not returned by spreading database records. Verification status and its attribution
must be consistent. Shared request/response schemas live in
`packages/shared/src/artist-api.ts`; the database schema remains unchanged.

Public artist queries are the next separate step. There is no list, public detail,
edit, delete, revoke, self-onboarding or artwork endpoint in this change.

## Verification

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
pnpm test
pnpm db:test
```

Unit tests verify input boundaries, role separation before persistence, server
identity/attribution, safe error mapping and private-field omission. Disposable
PostgreSQL tests use real signed sessions and the real routes/store to verify
concurrent creation, competing approvals, persisted verifier/time, rejected writes,
unknown IDs, replay, payout-only profiles and revoked-session rejection. The runner
uses synthetic data and in-memory identities and cleans up its owned container;
it does not read real `.env`, wallet keys or production data.

See [stored artist constraints](artist-profiles.md) and Drizzle's
[insert/conflict](https://orm.drizzle.team/docs/insert) and
[conditional update](https://orm.drizzle.team/docs/update) documentation.
