# Registry metadata commitments before minting

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

Both instructions require the artwork's canonical PDA and configured Core
collection. They reject a record with a bound Core asset. After minting, a
metadata change must use a later instruction that updates the Core URI and
Registry head atomically; these pre-mint instructions cannot bypass that
synchronization. Identity, attribution, verification, custody, and ownership
remain separate from metadata state.

`pnpm program:test` exercises successful initialization and revision, stale
writes, forged relationships, invalid content, post-mint rejection, and
preservation of version 1. The normal Anchor build generates the public
`target/idl/katha_registry.json`; application client generation is scheduled
for a later step.

See the [Anchor PDA constraints](https://www.anchor-lang.com/docs/references/account-constraints)
and [account space guide](https://www.anchor-lang.com/docs/references/space).
