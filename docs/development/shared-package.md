# Shared TypeScript package

`packages/shared` is the workspace package for contracts and utilities used by
more than one Katha application. It currently exports the general `JsonValue`
type. Artwork identities, lifecycle states, and request/response schemas are
introduced in later implementation steps.

## Build and check

```bash
pnpm --filter @katha/shared lint
pnpm --filter @katha/shared typecheck
pnpm --filter @katha/shared build
```

Build output and declarations are emitted to the ignored `packages/shared/dist`
directory. To consume the package from another workspace package, add
`"@katha/shared": "workspace:*"` to that package's dependencies, then import its
public exports from `@katha/shared`. The package export map points consumers to the
built JavaScript and declaration entrypoints.

`JsonValue` describes a recursive structural shape only. Validate untrusted JSON
and any domain-specific rules at the relevant application boundary.
