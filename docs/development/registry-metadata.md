# Registry metadata commitments

The Registry commits SHA-256 hashes of the exact canonical metadata document
bytes. The shared package defines serialization and hashing; the program accepts
a 32-byte digest and never receives rich text, media, or private evidence. A
caller must retain the exact bytes at the committed URI so an indexer or visitor
can fetch them and detect a mismatch. The Registry cannot establish that a URI
is reachable or that its content matches the hash during an on-chain transaction.

The configured registration authority first calls `initialize_metadata` for a
registered artwork. This creates a `MetadataHead` PDA derived from
`["metadata", artwork address]` and an immutable version 1 `MetadataRevision`
PDA derived from `["metadata-version", artwork address, version as little-endian
u32]`. The head points to the current revision and hash. Each revision stores
the artwork, exact hash, URI, authorizing wallet, timestamp, and version. The
head and revision are created atomically, so a failed transaction leaves neither.

Before Core minting, `revise_unminted_metadata` checks the caller's expected
current version, requires the next version to be exactly one greater, creates
that version's immutable revision, and advances the head in the same
transaction. Old revision accounts remain accessible. A URI relocation can create a new
version with the same document hash when the exact bytes are unchanged. A zero hash, wrong authority, unrelated artwork or head, stale or skipped version, or
invalid URI fails without changing the current pointer. The URI is limited to
200 ASCII bytes, an HTTP or HTTPS scheme with a nonempty host, and no embedded
credentials or fragment. Application and storage validation will be stricter.

The pre-mint instructions require the artwork's canonical PDA and configured Core
collection. They reject a record with a bound Core asset. Once minted,
`revise_minted_metadata` requires the configured registration signer, the bound
asset PDA, the current revision, and the canonical collection authority. It
checks the live Core asset's collection update authority, permanent Katha ID
name, and URI against the Registry's current revision before changing anything.
The Registry authority PDA signs Core's `UpdateV1` CPI, changing only the URI.
In the same transaction, the Registry creates the next immutable revision,
advances the head's version and hash, and emits `MetadataCommitted`. A failed
Core update rolls back the new revision and head change. Older revision accounts
remain available, and the artist attribution, Core owner, verification, and
physical custody do not change.

`pnpm program:test` exercises pre- and post-mint revisions, stale writes,
forged relationships, invalid content, Core rent failure rollback, preservation
of earlier versions, and unchanged artist and custody records. The normal Anchor build generates the public
`target/idl/katha_registry.json`. The [unsigned metadata builders](lifecycle-transactions.md)
validate canonical bytes, version linkage, and the live Core relationship for
post-mint revisions before composing generated Registry instructions.

See the [Anchor PDA constraints](https://www.anchor-lang.com/docs/references/account-constraints)
and [account space guide](https://www.anchor-lang.com/docs/references/space).

[Metadata commitment preparation](metadata-revisions-api.md) exposes authorized
unsigned initial, pre-mint and atomic post-mint metadata transactions with exact
stored-byte validation, reviewed version/hash checks and save-time eligibility guards.
