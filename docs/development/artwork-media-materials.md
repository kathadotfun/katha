# Artwork media and materials

`@katha/db` exports `artworkMedia`, `artworkMaterials`, their inferred record/insert
types, and media enums. Both tables reference the artwork UUID with restrictive
foreign keys. Media and material edits do not replace the permanent Katha ID or
artist attribution.

## Media records

Each media row stores a generated UUID, artwork UUID, kind, role, visibility,
zero-based position, storage reference, SHA-256 digest, MIME type, byte size,
optional alt text/caption and timestamps. Supported kinds are `IMAGE`, `VIDEO`
and `DOCUMENT`. Roles are `HERO`, `FRONT`, `BACK`, `DETAIL`, `ARTIST` (artist with
artwork), `PROCESS`, `CERTIFICATE`, `CONDITION`, `DOCUMENTARY` and `OTHER`.
Role defaults to `OTHER`; visibility defaults to `PRIVATE`.

The lowercase 64-character hash commits to the exact file bytes. PostgreSQL
validates its shape, not the file contents. The later storage provider must verify
bytes, size and MIME before recording them. Byte size is a positive SQL bigint,
represented as TypeScript `bigint`; an API must explicitly serialize it rather
than passing a database row directly to JSON.

Storage keys are provider-relative references of at most 512 characters. Allowed
characters are letters, digits, dots, underscores, hyphens and single slashes;
the first character must be alphanumeric. Absolute paths, URL query strings,
`.`/`..` path segments, repeated slashes and trailing slashes are rejected. Keep
signed URLs and credentials outside these references. File data stays outside Git.

The initial MIME allowlist pairs JPEG/PNG/WebP/AVIF with images, MP4/WebM with
videos, and PDF with documents. There is at most one hero row per artwork, and it
must be an image. Public images require nonblank alt text of at most 500
characters. Supplied captions must be nonblank and at most 1000 characters.
Update `updatedAt` explicitly when changing a row.

## Visibility and public queries

Only media explicitly approved as `PUBLIC` may enter a public response or public
metadata document. Filter by **both artwork UUID and visibility**, then order by
position. Project a safe response rather than returning raw database rows; storage
references and private evidence are internal. A media role, including certificate
or condition, never implies approval for publication.

The visibility column records an approval decision; it does not authenticate the
caller or protect the underlying file. Authorized write endpoints and storage
access controls are implemented in their later steps. Keep private file delivery
behind authorized access even if public and private records share this table.

## Materials and ordering

Each material has its own generated UUID, artwork UUID, name and position. Names
are nonblank, at most 120 characters, have no surrounding spaces, and contain no
commas. Insert `Cotton canvas` and `Natural mineral pigments` as separate rows.
Case-insensitive duplicate names are rejected within an artwork; another artwork
may use the same material name. Drafts may have no material rows. The shared
publication contract requires between one and twenty materials.

Both tables require nonnegative positions unique within each artwork. Gaps are
allowed. Queries must use ascending position explicitly. For a swap, use an unused
nonnegative position temporarily inside a transaction, then assign the final
positions. A direct swap can violate the immediate unique constraint. A failed
transaction restores both order and visibility. Later administration should
serialize competing edits to one artwork when assigning its complete order.
The table constraints use Drizzle's
[unique constraints, indexes and foreign keys](https://orm.drizzle.team/docs/indexes-constraints).

Draft media/material rows can be removed or edited without deleting the artwork.
These tables hold current editable documentation;
[immutable metadata and condition documents](artwork-attestations.md) preserve
historical commitments separately.

## Migration and verification

Migration `0002_artwork_media_materials.sql` creates both tables, three enums,
checks, foreign keys and unique indexes. Review it with its generated snapshot
and journal, then apply through the explicit commands in the
[database guide](database-package.md).

```bash
pnpm db:generate
pnpm --filter @katha/db typecheck
pnpm db:test
```

The disposable PostgreSQL suite checks private defaults, mixed media kinds,
public filtering, per-artwork ordering, hero uniqueness, transactional reorder
and rollback, invalid file references/hash/size/MIME, public image alt text,
material order and duplicate names, missing artwork links, invalid updates and
child deletion that preserves artwork identity. It also replays the full migration
history and exercises the previous artist and artwork constraints. It uses only
synthetic references and never reads artwork files or the development data volume.
