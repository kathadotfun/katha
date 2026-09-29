# Next.js web application

The public web application lives in `apps/web`. It uses the Next.js App Router,
TypeScript, React, and Tailwind CSS. The current page is only a working scaffold;
public browsing, artwork records, and the Katha design system are added in later
steps.

## Run the application

From the repository root, with the pinned Node.js and pnpm versions selected:

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/web dev
```

Open <http://localhost:3000>. Stop the development server with `Ctrl+C`.

## Verify the web package

```bash
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web build
```

`typecheck` generates Next.js route types before invoking TypeScript. Next.js
builds use Turbopack by default. Generated route declarations and build output
remain local and are excluded from Git.
