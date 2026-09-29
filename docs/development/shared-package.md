# Shared TypeScript package

`packages/shared` contains contracts and utilities used by more than one Katha
application. Its first domain contract validates the three MVP artwork categories
and permanent Katha IDs. Artist attribution, lifecycle states, and other
request/response schemas arrive in later steps.

The category values are `MANDALA`, `PAUBHA`, and `THANGKA`. A permanent ID uses
`KATHA-<CATEGORY>-<SEQUENCE>`, where the sequence is exactly six ASCII decimal
digits from `000001` through `999999`. Parsing is strict: it does not trim,
change case, or coerce input. For example, `KATHA-PAUBHA-000001` is valid while
`KATHA-PAUBHA-000000` is not. Allocation and uniqueness enforcement are added
with the database and Registry implementations; this schema validates shape only.

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
