# Canonical artwork document preparation

Two verifier-authorized endpoints prepare exact immutable documents:

- `POST /verifier/artworks/:kathaId/documents/metadata` accepts `expectedUpdatedAt`,
  the current artwork UTC millisecond timestamp.
- `POST /verifier/artworks/:kathaId/documents/condition` additionally accepts reportId,
  inspectorId, grade, reason, inspectedAt, reportedAt, notes and 1–20 unique mediaIds.
  Minted follow-up reports also require scope for transaction preparation: ownerWallet,
  positive custodyRevision and custodyState (KATHA_HELD or COLLECTOR_HELD).

Requests require a replay-protected wallet session on the configured cluster and
membership in the configured verifier allowlist. The session wallet supplies the
authority; clients cannot submit a verifier wallet, hash, URI, version, canonical
bytes, transaction receipt or approval status. These routes prepare documents;
they do not assert a finalized chain role, verification, minting or resale approval.
The later transaction endpoints recheck the actual Registry authority.

Responses are 201 with `{ id, kathaId, version, status: PREPARED, documentHash, uri }`
and Cache-Control:no-store. Unknown artworks return 404, stale timestamps, incomplete
metadata, unverified artists or conflicting report identities return 409. Malformed
requests return 400; storage/internal failures are redacted. Strict shared schemas
validate input and response. Future/past inspection ordering is checked before the
condition row is persisted.

## Consistent snapshot and versioning

The store locks the artwork FOR UPDATE before reading content, attribution, media
and materials. It also locks the referenced artist/media/material rows for sharing.
The service validates, hashes, stores and reads back bytes inside that transaction,
then inserts a PREPARED version with no chain receipt. Draft edits serialize on
that parent row and become frozen once a document references the artwork. Future
media/content writers must preserve this same locking protocol.

Local versions are allocated under the parent lock from the greatest existing
version. Identical latest PREPARED metadata from the same authority reuses its
record, including concurrent retries. Condition retries use immutable report IDs:
identical prepared bytes/authority reuse the report; altered or cross-artwork
identities conflict. Earlier versions are retained. Prepared rows use existing
database immutability/hash constraints; chainVersion stays null until reconciliation.

Database transactions cannot roll back filesystem writes. A failed preparation can
leave a hash-addressed object; public delivery requires an approved database reference,
so an unreferenced file alone is not served. No filesystem garbage collector is
added. Repeated puts deduplicate exact bytes safely.

## Public metadata

Metadata preparation is an explicit approval of the selected public snapshot for
HTTP delivery. The artwork need not yet be discoverable: discovery/detail retain
their publication/finalization gate. Operators must review public content before
requesting metadata preparation; it may then be fetched by its document hash.

The service requires the complete shared artwork contract, verified artist,
materials, dimensions, origin, cultural content and a PUBLIC HERO image. It reads
all PUBLIC media through StorageProvider and checks their exact hashes. Public
metadata includes schemaVersion 1, kathaId, name, category, immutable creator
attribution, creation year, origin, dimensions, materials, technique, publicContent,
hero image URI and ordered media{contentHash,mimeType,role,uri}. Private evidence,
artist payout settings, captions, condition notes, contact data and raw provider
paths are omitted. Private media never enters this document.

Canonical serialization preserves array order, sorts object keys and hashes the
exact UTF-8 bytes. The same bytes are stored PUBLIC and retained in PostgreSQL.
Document URI is bounded to 200 ASCII bytes for the existing Registry commitment.
Local/LAN HTTP(S) URLs, including localhost and IP hosts, are supported; credentials
and fragments are rejected. No public domain deployment is assumed.

## Private condition documents

Selected media must belong to the artwork and have IMAGE/CONDITION roles. Both
PUBLIC and PRIVATE inspection images are supported; each is verified through its
own storage namespace. Duplicate evidence hashes, invalid report times and future
reportedAt fail validation. The canonical condition schema binds report ID, artwork,
inspector, authenticated verifier, grade, reason, timestamps, notes and exact media
hashes. These bytes are stored PRIVATE and preserved in the condition row.

The prepared summary has uri:null. No private document/evidence HTTP route exists.
PRE_RESALE is a report reason, not resale authorization: owner/custody approval
scope is now hashed into minted reports and validated by
[condition transaction preparation](condition-attestation-api.md). This scope alone
does not authorize resale; the approval workflow remains scheduled.

## Public delivery

`GET /storage/public/:filename` accepts a lowercase SHA-256 basename plus a supported
extension. JSON is served only when a non-DRAFT metadata row references the hash,
its bytes satisfy the strict public metadata schema and storage integrity succeeds.
Other media requires a matching PUBLIC media reference. Private namespaces and
unreferenced files return 404; no filesystem directory is mounted. Responses use
the validated MIME type, nosniff and no-store. Query parameters are rejected.

Previously prepared metadata bytes remain retrievable; current media delivery also
requires current PUBLIC visibility. Changing media to PRIVATE can remove that media
from delivery but cannot retract a previously downloaded public snapshot. Condition
hashes and guessed private storage filenames never grant public access.

## Verification

Run `pnpm test`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm format:check` and `pnpm codegen:check`. Synthetic tests cover exact canonical
bytes, media verification, private omission, condition privacy, authorization,
input rejection, local URI delivery, concurrent retries, stale snapshots and
preserved condition history. PostgreSQL tests follow real PREPARED constraints;
no blockchain transactions, key reads or real artist uploads occur.

No dependency or migration change is required. Transaction preparation and
finalized receipt validation retain their later steps.

Administrators can prepare the same canonical public metadata through
`POST /admin/artworks/:kathaId/documents/metadata` for the
[registration workflow](artwork-registration-web.md). The request/response and
exact-byte rules match the verifier metadata route. This does not grant admin-only
wallets access to private condition preparation.

The integrated condition endpoint requires the current verifier authority and a
finalized inspection review. Only reviewed private condition-image IDs are selectable;
reason and owner/custody scope must match that review. UNKNOWN condition signatures
block replacement documents under the artwork lock. See
[condition inspection](condition-inspection-web.md).
