# Shared TypeScript package

`packages/shared` contains contracts and utilities used by more than one Katha
application. It validates the three MVP artwork categories, permanent Katha IDs,
artist attribution, and structured artwork documentation. Lifecycle states and
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
admin workflow must review it. Media and condition contracts arrive in later
steps.

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
inspection approval have separate contracts in later steps and are not valid
values in these enums.

The transition schemas validate action names and state pairs, not signer
permission or live on-chain state. Registry instructions must verify the actual
artwork record, current state, attested custodian, and authorized signer.

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
