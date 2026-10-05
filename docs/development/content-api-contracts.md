# Content API contracts

This reference describes the installed HTTP API. Request and response definitions
are exported by `@katha/shared`; the linked feature guides explain persistence and
lifecycle rules. Routes are relative to the configured API origin, normally
`http://localhost:3001`. The owned domain is `katha.fun`; this reference does not
assume hosted services or deployment there.

## Routes and access

Protected routes require `Authorization: Bearer <session-token>` from wallet
verification. Tokens are secrets: keep them out of URLs, public examples and Git.
Admin and verifier allowlists are independent; being an admin does not grant the
verifier role. Sessions must match the server cluster. Guards run before content
handlers. Role configuration and finalized Registry authority checks are explained
in [authorization](api-authorization.md); document preparation itself checks the
configured verifier role, not a finalized Registry role.

| Method and path                                            | Access                                          | Input contract                                                               | Success contract / status                                  |
| ---------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /health/live`                                         | Public                                          | None                                                                         | `{ "status": "alive" }` / 200                              |
| `GET /health/ready`                                        | Public                                          | None                                                                         | `{ "status": "ready" }` / 200; unavailable / 503           |
| `POST /auth/challenge`                                     | Public                                          | `walletChallengeRequestSchema`                                               | `walletChallengeResponseSchema` / 201                      |
| `POST /auth/verify`                                        | Public, signed challenge                        | `walletVerifyRequestSchema`                                                  | `walletSessionResponseSchema` / 200                        |
| `GET /auth/session`                                        | Session                                         | None                                                                         | `walletSessionSchema` / 200                                |
| `POST /auth/logout`                                        | Session                                         | None                                                                         | Empty body / 204                                           |
| `POST /admin/artists`                                      | Admin                                           | `artistCreateRequestSchema`                                                  | `artistResponseSchema` / 201                               |
| `POST /verifier/artists/:artistId/verification`            | Verifier                                        | UUID path; `artistVerificationRequestSchema`                                 | `artistResponseSchema` / 200                               |
| `GET /artists`                                             | Public                                          | `paginationQuerySchema`                                                      | `paginatedResponseSchema(publicArtistSummarySchema)` / 200 |
| `GET /artists/:slug`                                       | Public                                          | `artistSlugParamsSchema`                                                     | `publicArtistDetailSchema` / 200                           |
| `POST /admin/artworks`                                     | Admin                                           | `artworkDraftCreateRequestSchema`                                            | `artworkDraftResponseSchema` / 201                         |
| `POST /admin/artworks/:kathaId/operations/registration`    | Admin + Registry registration authority         | Permanent ID; empty query; `artworkRegistrationRequestSchema`                | `unsignedOperationResponseSchema` / 201                    |
| `POST /verifier/artworks/:kathaId/operations/verification` | Verifier + Registry verifier authority          | Permanent ID; empty query; `artworkVerificationRequestSchema`                | `unsignedOperationResponseSchema` / 201                    |
| `POST /verifier/artworks/:kathaId/operations/condition`    | Verifier + current Registry verifier            | `conditionAttestationRequestSchema`                                          | `unsignedOperationResponseSchema` / 201                    |
| `PATCH /admin/artworks/:kathaId`                           | Admin                                           | Permanent ID; `artworkDraftUpdateRequestSchema`                              | `artworkDraftResponseSchema` / 200                         |
| `GET /artworks`                                            | Public                                          | `artworkDiscoveryQuerySchema`                                                | `artworkDiscoveryResponseSchema` / 200                     |
| `GET /artworks/:kathaId`                                   | Public                                          | Permanent ID; empty query                                                    | `publicArtworkDetailSchema` / 200                          |
| `GET /artworks/:kathaId/provenance`                        | Public                                          | Permanent ID; `artworkProvenanceQuerySchema`                                 | `artworkProvenanceResponseSchema` / 200                    |
| `POST /verifier/artworks/:kathaId/documents/metadata`      | Verifier                                        | Permanent ID; `metadataPreparationRequestSchema`                             | `preparedDocumentResponseSchema` / 201                     |
| `POST /verifier/artworks/:kathaId/documents/condition`     | Verifier                                        | Permanent ID; `conditionPreparationRequestSchema`                            | `preparedDocumentResponseSchema` / 201                     |
| `GET /storage/public/:filename`                            | Public, approved reference                      | Hash filename; empty query                                                   | Verified bytes and validated MIME type / 200               |
| `POST /admin/artworks/:kathaId/operations/custody`         | Admin + current Registry custody authority      | `custodyPreparationRequestSchema`                                            | `unsignedOperationResponseSchema` / 201                    |
| `POST /admin/artworks/:kathaId/operations/mint`            | Admin + current Registry registration authority | `artworkMintRequestSchema`                                                   | `unsignedOperationResponseSchema` / 201                    |
| `POST /admin/artworks/:kathaId/operations/metadata`        | Admin + current Registry registration authority | `metadataRevisionRequestSchema`                                              | `unsignedOperationResponseSchema` / 201                    |
| `POST /operations/:operationId/receipts`                   | Session + own operation/preparation             | `operationReceiptParamsSchema`; empty query; `operationReceiptRequestSchema` | `operationReceiptResponseSchema` / 200                     |
| `POST /fulfillment/artworks/:kathaId`                      | Session + current Core owner                    | `fulfillmentCreateRequestSchema`                                             | `fulfillmentResponseSchema` / 201                          |
| `GET /fulfillment/:requestId`                              | Original requester or admin                     | `fulfillmentIdParamsSchema`, empty query                                     | `fulfillmentResponseSchema` / 200                          |
| `PATCH /admin/fulfillment/:requestId`                      | Admin                                           | `fulfillmentUpdateRequestSchema`                                             | `fulfillmentResponseSchema` / 200                          |

Wallet challenge expiry, exact signed-message requirements, single-use verification
and logout behavior are in [wallet authentication](wallet-authentication.md).
[Artwork registration](artwork-registration-api.md), [verification](artwork-verification-api.md),
[condition](condition-attestation-api.md) and [custody](custody-operations-api.md)
preparation return unsigned transactions for the authorized wallet. Private
fulfillment status is manual coordination, separate from finalized custody.
Uninstalled paths return the shared 404 envelope after applicable middleware.
Upload, draft-list and marketplace routes remain planned.
[Public provenance and condition timelines](artwork-provenance-api.md) expose
finalized history and persisted indexing observations.

## Input and concurrency rules

JSON objects are strict: unknown fields, malformed JSON and invalid values return 400. Send `Content-Type: application/json`; charset parameters are accepted.
Unsupported content types return 415. [REST boundaries](api-rest.md) define CORS,
64 KiB ordinary body limits and the 10 MiB multipart transport ceiling.

Parsed queries reject duplicate and unknown keys. `/artists` accepts `limit` and
`offset`; `/artworks` also accepts exact uppercase `category` values `MANDALA`,
`PAUBHA` or `THANGKA`. Limits default to 20, range 1–100; offsets default to 0,
range 0–100000. Use canonical unsigned decimals without leading zeroes. List
responses contain numeric pagination values and `hasMore`, not a total count.
Artwork detail, public storage and registration preparation accept no query fields.
Other write routes do not uniformly validate queries; follow each path/JSON contract.

Permanent IDs have the form `KATHA-PAUBHA-000001`, with a supported uppercase
category and six digits; zero is reserved. The server allocates them. Draft
creation requires a caller-generated `creationRequestId` UUID retained for retries,
artist ID, category, title and creation year. Optional documentation fields and
bounds are in [draft creation](artwork-drafts-api.md). Creator attribution is
snapshotted from the artist; clients cannot supply ownership or custody fields.

Draft PATCH requires `expectedUpdatedAt` plus at least one supported content edit.
Use the exact UTC millisecond timestamp from the latest create/update response.
Identity is immutable; stale, published or lifecycle-bound edits conflict. There
is currently no administrative draft-fetch endpoint. See [draft editing](artwork-draft-editing-api.md).

Document preparation also requires `expectedUpdatedAt`. Metadata content is
selected on the server, not supplied as canonical bytes. Condition preparation
adds report/inspector UUIDs, grade, reason, UTC millisecond inspection/report times,
nonblank notes and 1–20 unique media UUIDs. Report time must be at or after inspection and
cannot be in the future. Media must belong to that artwork with IMAGE/CONDITION
roles. The session supplies the verifier wallet. See [document preparation](document-preparation.md)
for version allocation, retry conflicts, complete-metadata requirements and storage
integrity checks. All returned prepared records have `status: "PREPARED"`; these
requests do not verify, mint, approve resale or submit blockchain transactions.

## Public and private projections

| Surface                      | Exposed                                                                                                               | Withheld or qualified                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public artist lists/details  | Verified profiles, approved biography/links; detail may include creator wallet                                        | Payout wallet, verifier wallet, private settings; related artwork array is currently empty                                                                 |
| Public artwork lists         | Permanent ID, category, title/year, artist identity and PUBLIC hero image ID/hash                                     | Evidence, storage keys, captions, wallet addresses and fulfillment                                                                                         |
| Public artwork detail        | Approved content/materials/public media, finalized attestation summaries, indexed ownership and manual custody labels | Private evidence/documents/notes, provider paths and fulfillment; indexed ownership is an observation, manual custody is not a finalized chain attestation |
| Public artwork provenance    | Finalized chain commitments, typed history and persisted indexing status                                              | Private notes, evidence bytes, media hashes, fulfillment and raw payloads                                                                                  |
| Admin artist/draft responses | Fields needed to manage profiles/drafts, including artist payout settings or draft evidence hash                      | These are protected responses, not public profile contracts                                                                                                |
| Prepared public metadata     | Canonical approved artwork content, attribution and PUBLIC media references                                           | Evidence hash, payout settings, captions, condition notes and PRIVATE media                                                                                |
| Prepared condition response  | ID, version, document hash and `uri: null`                                                                            | Private canonical bytes, notes and inspection media delivery                                                                                               |

Discovery and detail share the publication gate: a publication marker not in the
future, verified artist, evidence commitment, finalized verification, metadata and
initial condition on the configured cluster, and indexed ownership. Missing and
ineligible artworks both return 404. [Detail documentation](artwork-details-api.md)
explains UNKNOWN/gap indexing status, nullable bindings and finalized summaries;
these responses do not promise live chain freshness or a complete provenance timeline.

**Preparing metadata approves its public snapshot for delivery even before artwork
publication.** Review public fields before preparation. A non-DRAFT metadata
reference can authorize its JSON by hash independently of the discovery gate.
Earlier prepared versions remain retrievable. Public media delivery requires a
current PUBLIC reference; making media private cannot retract an already downloaded
snapshot. The public storage route checks exact-byte integrity and filenames with
lowercase SHA-256 plus `json`, `jpg`, `png`, `webp`, `avif`, `mp4`, `webm` or `pdf`.
A file existing on disk does not authorize delivery. There is no private storage
HTTP route, and knowing a condition hash does not grant access.

## Errors and response headers

Application errors use this strict response shape; this example uses synthetic data:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request is invalid."
  },
  "requestId": "11111111-1111-4111-8111-111111111111"
}
```

| Status | Code                     | Fixed message                                 |
| ------ | ------------------------ | --------------------------------------------- |
| 400    | `INVALID_REQUEST`        | The request is invalid.                       |
| 401    | `UNAUTHENTICATED`        | Sign in to continue.                          |
| 403    | `FORBIDDEN`              | This action is not permitted.                 |
| 404    | `NOT_FOUND`              | The requested resource was not found.         |
| 409    | `CONFLICT`               | The request conflicts with the current state. |
| 413    | `PAYLOAD_TOO_LARGE`      | The request body is too large.                |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | The request content type is not supported.    |
| 500    | `INTERNAL_ERROR`         | An unexpected error occurred.                 |

Readiness is the exception: an unavailable database returns 503 with
`{ "status": "unavailable" }`, not an application error envelope. Each request
receives a new server-generated UUIDv4 in `X-Request-Id`; error bodies repeat it.
Private routes, health and public storage use `Cache-Control: no-store`; storage
adds `X-Content-Type-Options: nosniff`. Logs omit URLs, queries, bodies, signatures,
tokens and raw exceptions. See [errors and logging](api-errors-logging.md).

## Synthetic request examples

These examples validate against the shared request schemas. They demonstrate
shapes, not existing records, permissions, evidence or artwork eligibility.
Authenticated examples require a real session from your local wallet workflow.

Create an artist (`POST /admin/artists`):

```json
{
  "slug": "synthetic-artist",
  "displayName": "Synthetic Artist",
  "biography": "Fictional profile used to demonstrate the API contract.",
  "region": "Kathmandu",
  "traditions": ["Paubha"],
  "creatorWallet": null,
  "payoutWallet": null
}
```

Create a draft (`POST /admin/artworks`):

```json
{
  "creationRequestId": "11111111-1111-4111-8111-111111111111",
  "artistId": "22222222-2222-4222-8222-222222222222",
  "category": "PAUBHA",
  "title": "Synthetic Paubha",
  "creationYear": 2026
}
```

Edit that draft (`PATCH /admin/artworks/KATHA-PAUBHA-000001`):

```json
{
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "story": "Fictional documentation for a synthetic artwork."
}
```

Prepare metadata (`POST /verifier/artworks/KATHA-PAUBHA-000001/documents/metadata`):

```json
{
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z"
}
```

Prepare a private condition document (same path prefix, `/documents/condition`):

```json
{
  "expectedUpdatedAt": "2026-10-05T00:00:00.000Z",
  "reportId": "33333333-3333-4333-8333-333333333333",
  "inspectorId": "44444444-4444-4444-8444-444444444444",
  "grade": "GOOD",
  "reason": "INITIAL_VERIFICATION",
  "inspectedAt": "2026-10-04T10:00:00.000Z",
  "reportedAt": "2026-10-04T11:00:00.000Z",
  "notes": "Synthetic inspection notes; no real artist evidence.",
  "mediaIds": ["55555555-5555-4555-8555-555555555555"]
}
```

For anonymous discovery, request
`GET /artworks?category=PAUBHA&limit=20&offset=0`.
`GET /artworks?limit=01`, repeated `limit`, or a detail query such as
`GET /artworks/KATHA-PAUBHA-000001?includePrivate=true` returns 400.

## Verification

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
`pnpm format:check`. Shared and API tests cover strict schemas, actual Hono routes,
authorization before side effects, safe projections, publication gates, document
privacy and approved-byte delivery. `pnpm db:test` exercises disposable PostgreSQL
constraints and service integration when database behavior changes. Examples above
can be parsed from their JSON fences and validated with the named shared schemas;
no real sessions, credentials or private uploads are needed to check their shapes.

[Artwork verification preparation](artwork-verification-api.md) additionally requires
explicit manual authenticity confirmation and matching finalized registration.
Prepared operations are private pending intent, separate from finalized attestations.

[Condition attestation preparation](condition-attestation-api.md) validates exact private
report bytes and reviewed chain version, with owner/custody scope after minting.

[Custody and manual fulfillment](custody-operations-api.md) separates private request
status from authority-signed physical movement and finalized history.

[Artwork mint preparation](artwork-minting-api.md) binds the latest approved metadata
and version-1 initial report to valid finalized chain prerequisites. No publication
or finalized ownership is created by the unsigned response.

[Metadata commitment preparation](metadata-revisions-api.md) validates exact stored
versions and immutable attribution before initializing or revising commitments.
Minted revisions synchronize Core URI atomically; preparation creates no finalized history.

[Finalized operation receipts](operation-receipts-api.md) validates the signed copy
of an owned preparation and finalized RPC evidence. Receipt/operation status is
separate from indexed document projections and successful provenance.
