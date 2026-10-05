# Public artwork details

`GET /artworks/:kathaId` returns an anonymous public detail response keyed by the
permanent Katha ID. It uses exactly the [discovery publication predicate](artwork-discovery-api.md):
unpublished, future-published, unverified or incomplete lifecycle records return
`404 NOT_FOUND`, just like absent records. No private draft information is disclosed.
Malformed IDs and any query parameter return `400 INVALID_REQUEST`; callers cannot
choose a cluster or include private fields. Unexpected storage or response-integrity
errors produce the standard redacted 500 response.

```http
GET /artworks/KATHA-PAUBHA-000001
```

## Response fields

The shared `publicArtworkDetailSchema` defines strict public JSON:

- Identity: `kathaId`, category, title, creation year and artist{id, slug, displayName}.
  `creatorWallet` is the immutable artwork snapshot, not the owner's wallet or the
  artist profile's mutable payout settings. Walletless authors remain null.
- Content: dimensions in integer millimetres, origin{countryCode, region, locality},
  technique, story, meaning, cultural context, creation process and ordered material
  names. Optional documentation remains null when absent; it is never fabricated.
- Media: ordered PUBLIC records with id, kind, role, position, SHA-256 content hash,
  MIME type and nullable alt text. Provider keys, captions and private media are
  omitted. IDs/hashes are not downloadable URLs; approved delivery uses the
  [public storage route](document-preparation.md#public-delivery).
- Verification: VERIFIED status, verifier wallet, inspection time, document hash
  and finalized transaction reference.
- Metadata: latest finalized chain version, public document URI, hash and transaction.
- Condition: latest finalized chain version, grade, reason, inspection time, verifier
  wallet, hash and transaction. Prepared/draft revisions never replace finalized
  summaries. Private report text, inspector IDs and evidence media are omitted.
- Custody: state, source and observation time. Existing custody records are manual
  observations and use `source: MANUAL_OBSERVATION`. With none, state/source are
  UNKNOWN and observation time is null. This is separate from digital ownership and
  does not claim a finalized Registry custody attestation.
- Ownership: indexed owner wallet, `source: INDEXED_CORE`, indexing observation time
  and the source event's transaction reference. This is an indexed observation, not
  a live Core RPC query or a guarantee that this wallet still owns the asset.
- Chain: configured LOCALNET/DEVNET cluster and indexed Core asset address. Registry
  record and collection addresses are explicitly null until those validated bindings
  are persisted; indexed JSON payloads are never trusted to invent them.
- Indexing: UNKNOWN freshness, or GAP_DETECTED when the ownership-source program
  checkpoint has a recorded gap. The nullable checkpoint includes program address,
  scanned-through slot, gap bounds and update time. It describes that program only;
  a gap-free checkpoint cannot prove complete Registry/Core/Marketplace coverage.

Transaction references contain signature, integer decimal-string slot and UTC
millisecond `recordedAt`. Checkpoint slots also use decimal strings, preserving
values above JavaScript's safe-integer limit. Hashes identify committed bytes;
this endpoint does not fetch/recompute metadata or assert integrity verification.

## Read consistency and privacy

The database store uses a read-only REPEATABLE READ transaction. Publication,
content, ordered relations, finalized summaries and indexed ownership are read from
one snapshot. Metadata and condition select greatest finalized chain version on
the configured cluster. Verification selects greatest finalized slot with an ID
tie-breaker. Custody selects greatest manual revision.

Both database selection and API JSON projection explicitly allow public fields.
They never select private fulfillment requests, raw indexed payloads, canonical
inspection documents, authorship evidence, storage paths, creation request IDs or
payout wallets. Publication approves artwork content; it does not make operational
records public. Storage failures do not reveal private error messages.

Full provenance/condition timelines and aggregate indexing status belong to the
later provenance endpoint. Publication administration, indexing and receipt
reconciliation retain their planned steps. Artist detail's related-artwork array
remains empty pending its own integration; this endpoint does not alter it.

## Verification

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm db:test`, `pnpm build`,
`pnpm format:check` and `pnpm codegen:check`. Unit cases cover strict ID/query
validation, absence, nullable documentation/custody, public projections, decimal
slots, checkpoint gaps and redacted failures. PostgreSQL coverage verifies the
shared publication gate, cluster isolation, latest finalized metadata despite a
newer prepared revision, ordered materials, manual custody, private media filtering
and real checkpoint reads. Test receipts/events are synthetic; no blockchain
transaction or live ownership verification is performed.

No new migration or dependency is required for this endpoint.
