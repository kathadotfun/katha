# Database package boundary

`packages/db` is the Node-only workspace boundary for PostgreSQL access. The
package currently contains only a buildable entrypoint; it defines no connection,
ORM, tables, migrations, or query behavior. Those arrive in their planned steps.

## Build and check

```bash
pnpm --filter @katha/db lint
pnpm --filter @katha/db typecheck
pnpm --filter @katha/db build
```

Build output and declarations are emitted to the ignored `packages/db/dist`
directory. The package export map provides types to tooling and a runtime entry
only under the Node.js export condition. Browser-targeted bundlers cannot resolve
the package's runtime entrypoint.
