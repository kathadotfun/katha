# Shared TypeScript package

`packages/shared` contains contracts and utilities used by more than one Katha
application. It validates the three MVP artwork categories, permanent Katha IDs,
artist attribution, and structured artwork documentation. Lifecycle and
condition-report and marketplace contracts are also defined here. API
request/response schemas arrive in later steps.

The category values are `MANDALA`, `PAUBHA`, and `THANGKA`. A permanent ID uses
`KATHA-<CATEGORY>-<SEQUENCE>`, where the sequence is exactly six ASCII decimal
digits from `000001` through `999999`. Parsing is strict: it does not trim,
change case, or coerce input. For example, `KATHA-PAUBHA-000001` is valid while
`KATHA-PAUBHA-000000` is not. Allocation and uniqueness enforcement are added
with the database and Registry implementations; this schema validates shape only.

`artistAttributionSchema` identifies an artist by a stable UUID and display name;
the creator wallet may be absent. `artistProfileSchema` adds biography, region,
traditions, public links, and a separate optional payout wallet. A profile can
exist without either wallet. The payout wallet becomes mandatory at the later
sale-eligibility boundary. Wallet fields are checked for base58 text shape here;
chain-facing code must decode and validate the actual address. The profile
contract includes payout configuration and is not itself a public API response
schema.

`artworkSchema` requires a matching ID and category, title, attribution, a
lowercase 64-character SHA-256 authorship evidence hash, creation year, structured
origin, integer dimensions in millimetres, materials, technique, and public story,
meaning, cultural context, and process text. Nested objects reject unlisted
fields, including accidental private evidence or fulfillment fields. This
schema does not determine whether text is approved for publication; the later
admin workflow must review it. Artwork media contracts arrive in later steps.

## Independent lifecycle states

The shared lifecycle contracts keep three dimensions distinct:

| Dimension            | Values                                                  | Named changes                              |
| -------------------- | ------------------------------------------------------- | ------------------------------------------ |
| Artwork registration | `DRAFT`, `REGISTERED`                                   | `REGISTER`                                 |
| Artwork verification | `UNVERIFIED`, `VERIFIED`                                | `VERIFY_ARTWORK` after registration        |
| Physical custody     | `UNKNOWN`, `KATHA_HELD`, `COLLECTOR_HELD`, `IN_TRANSIT` | Initial attestation, dispatch, and receipt |

`UNKNOWN` means there is no custody attestation. `COLLECTOR_HELD` describes a
recorded physical custodian, whose identity must be stored separately; it does
not imply possession by the current Core owner. Physical moves pass through
`IN_TRANSIT`, including a direct handoff recorded as dispatch and receipt. A
purchase or listing does not itself change custody. Listing status and resale
inspection approval are separate from custody and are not valid values in these
enums.

The transition schemas validate action names and state pairs, not signer
permission or live on-chain state. Registry instructions must verify the actual
artwork record, current state, attested custodian, and authorized signer.

## Condition reports

`conditionReportDocumentSchema` validates a detailed inspection document with a
stable report UUID, permanent artwork ID, grade, reason, inspector UUID, verifier
wallet, inspection and report times, notes, and one to twenty unique lowercase
SHA-256 media hashes. Grades are `EXCELLENT`, `GOOD`, `FAIR`, `POOR`, and
`DAMAGED`. Reasons are `INITIAL_VERIFICATION`, `PRE_SALE`, `POST_DELIVERY`,
`PRE_RESALE`, `RETURN_TO_CUSTODY`, and `INSURANCE`. A reason describes why an
inspection occurred; it does not grant resale approval or change custody.

Times use UTC with exactly three fractional second digits, such as
`2025-06-15T09:30:00.000Z`. The report time cannot precede the inspection time.
The document rejects unlisted fields, including shipping details and private
photo URLs. Notes and associated media may contain sensitive information, so the
full document must be stored privately and must not be returned directly by a
public API. Public summaries require an explicit visibility review.

`conditionReportCommitmentSchema` validates the separate report UUID, artwork ID,
and lowercase SHA-256 report hash. Keeping the hash outside the document avoids
self-reference. The later canonical-hashing step computes it from exact document
bytes; persistence must ensure the document and commitment share their identities
and preserve prior reports. Later Registry instructions verify signer authority
and anchor the commitment and verifier on-chain. These schemas validate shape and
chronology only; they do not prove inspection or authorize an attestation.

## Listings and exact payment values

`listingStatusSchema` accepts `ACTIVE`, `CANCELLED`, `PURCHASED`, and `EXPIRED`.
An active listing can already be ineligible after its expiry timestamp; `EXPIRED`
records completed expiry recovery. Listing status does not change physical
custody, verification, or inspection approval. Later Marketplace instructions
validate live ownership, expiry, eligibility, and authorized transitions.

`tokenAmountSchema` accepts canonical unsigned decimal strings from `"0"` through
`"18446744073709551615"`, the full Solana `u64` range in token base units.
`listingPriceSchema` uses the same bound but requires a positive amount. JSON
numbers, signs, leading zeros, fractions, exponent notation, and overflow are
rejected so client and server do not silently round token values. A six-decimal
test-token amount of one whole token is `"1000000"` base units; decimal display
and conversion belong at the application boundary.

`basisPointsSchema` accepts integer numbers from 0 through 10,000.
`marketplaceFeeRatesSchema` validates separate platform commission and secondary
artist royalty rates and rejects a combined rate over 10,000 basis points. The
Devnet simulation defaults are 250 and 500 basis points respectively. These
contracts validate configuration shapes, not actual settlement; checked fee
arithmetic and recipient verification belong to the Marketplace program.

## Canonical document commitments

`canonicalDocumentBytes` turns a validated JSON value into UTF-8 bytes using
[JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
serialization rules: object keys sort by UTF-16 code unit, nested objects sort
recursively, and array order remains unchanged. There is no BOM, whitespace, or
trailing newline. The shared implementation rejects unsupported or lossy values,
including `undefined`, non-finite or unsafe integers, sparse arrays, non-plain
objects, accessors, cycles, symbol fields, and unpaired Unicode surrogates.
Amounts that may exceed JavaScript's safe integer range remain decimal strings.

Validate each document with its strict domain schema before canonicalization.
For public metadata, include only approved public fields; a private condition
report is a different document and must never be merged into public metadata.
The generic byte function cannot decide which content is approved for publication.

`sha256Hex` returns a lowercase SHA-256 digest of the **provided bytes** using Web
Crypto. Store or publish the exact `canonicalDocumentBytes` output that was
hashed, and compare those same bytes against the Registry commitment later.
Changing a field or reordering media changes the digest; reordering object keys
does not. Document versioning, storage, and on-chain anchoring arrive in later
steps.

```ts
import { artworkSchema, canonicalDocumentBytes, sha256Hex } from "@katha/shared";

declare const input: unknown;
const bytes = canonicalDocumentBytes(artworkSchema.parse(input));
const hash = await sha256Hex(bytes);
```

```ts
import { artworkCategorySchema, kathaIdSchema } from "@katha/shared";

artworkCategorySchema.parse("PAUBHA");
kathaIdSchema.parse("KATHA-PAUBHA-000001");
```

## Build and check

```bash
pnpm --filter @katha/shared lint
pnpm --filter @katha/shared typecheck
pnpm --filter @katha/shared test
pnpm --filter @katha/shared build
```

Build output and declarations are emitted to the ignored `packages/shared/dist`
directory. To consume the package from another workspace package, add
`"@katha/shared": "workspace:*"` to that package's dependencies, then import its
public exports from `@katha/shared`. The package export map points consumers to the
built JavaScript and declaration entrypoints.

`JsonValue` remains a recursive structural type only. Validate untrusted JSON
and domain rules at the relevant application boundary.

Shared [REST contracts](api-rest.md) now define fixed errors, strict error responses,
request-size constants and bounded pagination. Existing token amount schemas remain
the HTTP payment boundary: canonical integer decimal strings, never JSON numbers.
