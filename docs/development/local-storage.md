# Local storage provider

The API's `StorageProvider` boundary exposes `put({ bytes, mimeType, visibility })`
and `read(reference)`. `createLocalStorageProvider({ root, maxBytes })` supplies the
local development implementation. Construction/import does not create directories
or read environment files. [Canonical document preparation](document-preparation.md) and [media administration](artwork-media-administration.md)
inject this boundary. Approved public delivery uses that document service; the
provider itself mounts no directory. The admin media API handles uploads; no private
download route is exposed.

## References and immutable writes

A successful put returns `{ storageKey, contentHash, mimeType, byteSize, visibility }`.
The SHA-256 hash covers exact input bytes. Byte size is an integer decimal string.
Keys are generated internally as `public/<hash>.<extension>` or
`private/<hash>.<extension>`. Caller filenames never determine filesystem paths.
The strict reference schema checks key/hash/MIME/visibility agreement before reads.

The provider snapshots caller-owned bytes, writes an exclusive random temporary
file, flushes it, and atomically links it to the final hash-addressed name without
replacing an existing object. Repeated/concurrent writes deduplicate only after
checking existing bytes, size and hash. Corrupt objects cause INTEGRITY_FAILURE;
they are never silently overwritten. Successful/failed writes attempt to remove
their temporary file. A process crash can leave `.pending-*` files; the trusted
operator may remove these while the service is stopped. They are not valid object
references. Reads are bounded and recheck size, hash and content type.

PUBLIC and PRIVATE use separate directories even for identical hashes. Private
objects never resolve through the public namespace. Writing a public copy requires
an explicit PUBLIC put by an authorized caller; knowing a hash is not publication
authorization. The provider is a server-only byte store, not an authorization layer:
future private read/write endpoints must enforce wallet roles and object ownership.
Future public delivery must resolve an approved public reference and must never
mount the whole storage directory as static files.

## Validation and limits

Supported types are JPEG, PNG, WebP, AVIF, MP4, WebM, PDF and JSON. Media/PDF types
require matching recognizable file signatures; SVG, HTML and unsupported MIME types
are rejected. This checks container markers, not complete codec decoding or image
transformation. JSON requires valid UTF-8 and a non-null object rather than an array
or scalar. Canonical document serialization belongs to the document-preparation
step; storage hashes bytes without rewriting JSON.

Empty objects are rejected. The default object limit is 10 MiB, configurable up to
50 MiB. JSON documents additionally have a fixed 1 MiB ceiling. Validation occurs
before filesystem writes. HTTP body limits remain independent. Admin media uploads allow an 8 MiB file
within a 10 MiB multipart body and exclude JSON; canonical JSON uses the document service.

## Filesystem and configuration

`KATHA_STORAGE_ROOT` is server-only. It defaults to `.storage` under the process
working directory (normally `apps/api` for pnpm's API scripts). Overrides must be
absolute normalized paths ending in `/.storage`; the parent must already exist.
Every `.storage/` directory is ignored by Git. Keep real content, including approved
public artwork media, outside public Git history.

`KATHA_STORAGE_MAX_BYTES` defaults to 10485760 and accepts a canonical positive
integer through 52428800. Neither setting appears in public configuration; public
STORAGE aliases are rejected. See `.env.example` for safe examples.

This implementation targets the project's Linux development environment. New root
and namespace directories use 0700, and published files use 0400. The provider
rejects symlink ancestors, roots, namespaces and final files, plus non-directory
ancestors and group/world-writable or differently owned storage directories. Files
are opened with O_NOFOLLOW and checked as regular files. Only the trusted API
process/operator should control the tree: same-user concurrent directory replacement
is outside this adapter's isolation boundary. Content hashes detect file tampering;
filesystem permissions cannot turn local storage into permanent archival storage.

Failures expose fixed codes: INVALID_OBJECT, TOO_LARGE, UNSAFE_PATH, NOT_FOUND,
INTEGRITY_FAILURE or IO_FAILURE. Raw paths, underlying filesystem errors and private
content are not included. API handlers will map provider errors to validated domain
responses when the relevant workflow is implemented.

## Verification

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and
`pnpm format:check`. Storage tests use synthetic bytes under temporary directories
and remove them afterwards. They cover exact hashes, restarts, concurrent writes,
caller mutation, supported signatures, invalid content/size/MIME/visibility, missing
objects, traversal, symlinks, permissions, tampering and namespace isolation.
Configuration tests cover path/size validation and public-setting exclusion.

No package installation, database migration, real upload or blockchain operation
is needed for this provider step.
