# Artwork media administration

Open a saved artwork's **Manage artwork media** link at
`/admin/artworks/:kathaId/media`. A configured administrator session is required.
Verifier-only and collector wallets cannot read or change these records. Sign-out,
wallet changes and expiry clear loaded records and discard late responses.

## Operator workflow

1. Review the original locally, including embedded metadata and permissions to
   publish it. Uploads default to PRIVATE. Select a role and supply descriptions.
2. Upload one file: JPEG, PNG, WebP, AVIF, MP4, WebM or PDF, up to 8 MiB. SVG, HTML
   and JSON are excluded. An artwork supports at most 20 media records.
3. Move rows earlier or later, adjust role, alt text, caption and visibility, then
   save the entire ordered list. Only one HERO is allowed, and it must be an image.
4. Explicitly approve every PUBLIC row for each save, including an unchanged row.
   Public images require alt text. The CONDITION role always remains PRIVATE.

PUBLIC approval exposes the exact bytes through the existing hash-addressed public
delivery endpoint, even before artwork publication. Remove private information and
EXIF before approval; this implementation does not sanitize, transcode or strip
embedded data. File validation checks recognizable container signatures, not full
decoding. Review the original file locally; the admin page provides no preview or
private download facility. Alt text is limited to 500 characters and captions to
1,000; empty descriptions become null.

Changing PUBLIC to PRIVATE stops delivery through that row. Already downloaded
copies cannot be recalled. Another approved public row with identical bytes can
still authorize the same hash. Visibility changes preserve the byte hash and copy
to the appropriate storage namespace; they do not rewrite the original bytes.

## HTTP contracts

All three endpoints are admin-only and use bearer authentication. JSON schemas
are shared by the API and browser; unknown fields are rejected.

| Method | Path                             | Body                                                        |
| ------ | -------------------------------- | ----------------------------------------------------------- |
| GET    | `/admin/artworks/:kathaId/media` | None                                                        |
| POST   | `/admin/artworks/:kathaId/media` | Exactly one `file` part and one JSON-string `metadata` part |
| PATCH  | `/admin/artworks/:kathaId/media` | `{ expectedUpdatedAt, items }`                              |

POST metadata contains `expectedUpdatedAt`, `mimeType`, `role`, `visibility`,
`altText`, `caption` and `approvedPublic`. The file MIME must match the declaration.
Multipart bodies are bounded to 10 MiB, metadata to 4,096 characters. Duplicate
parts are rejected. Browser code sends FormData without manually setting its
Content-Type, so the browser supplies the multipart boundary.

PATCH items contain `id`, `role`, `visibility`, `altText`, `caption` and
`approvedPublic`. Supply every existing ID exactly once in the desired order;
inserting foreign IDs, omitting records or deleting media is unsupported.

Success returns `{ kathaId, updatedAt, editable, items }`. Each item exposes its
UUID, role, visibility, descriptions, kind, MIME, decimal-string byte size, hash
and zero-based position. Responses omit filenames, storage keys, private bytes
and private URLs. POST returns 201; reads/updates return 200. Missing works return
404, unauthorized sessions 401/403, invalid inputs 400, oversized bodies/files
413, and stale or closed editing windows 409.

## Concurrency and storage

Media uses the same conservative editing window as draft documentation: publication
or any metadata/attestation/blockchain-operation lifecycle record closes writes.
The server rechecks eligibility on every write. GET's `editable` is a display hint.
Artwork locks serialize writers and `expectedUpdatedAt` must match the saved
timestamp. Ordering, roles and parent timestamp commit in one PostgreSQL transaction;
constraint failure rolls them back. Content-addressed files are independently
immutable. Failed transactions can leave unreferenced objects on disk, which the
public delivery service cannot serve without an approved database reference.

Concurrent or uncertain writes pause browser saves. Reload saved media before
trying again; reselect a file and explicitly approve any public rows. Cancellation
cannot undo a write that already reached the server. No automatic write retry or
object garbage collection is implemented here. Storage remains outside Git.

## Verification

`pnpm db:test` verifies real PostgreSQL locking, order swaps, rollback, stale writes,
visibility copies, private delivery rejection and closed windows using disposable
databases and synthetic bytes. API/shared tests cover authorization, strict input
projection and storage failures. `pnpm --filter @katha/web test:public-journeys`
covers upload, validation, reordering, publication approval and conflict recovery
at 320, 768 and 1,440 pixels with accessibility scans.

See [local storage](local-storage.md), [MDN FormData](https://developer.mozilla.org/en-US/docs/Web/API/FormData)
and [Drizzle transactions](https://orm.drizzle.team/docs/transactions).
