# Next.js web application

The public web application lives in `apps/web`. It uses the Next.js App Router,
TypeScript, React, and Tailwind CSS. The current page is only a working scaffold;
the [design system](design-system.md) now defines colours, typography and the
approved emblem. The [public application shell](application-shell.md) adds responsive navigation
and a footer. The [canonical artwork page](artwork-page.md) now presents approved public
photography and cultural documentation; discovery and artist pages follow later.

## Run the application

From the repository root, with the pinned Node.js and pnpm versions selected:

```bash
pnpm install --frozen-lockfile
pnpm --filter @katha/shared build
pnpm --filter @katha/web dev
```

Open <http://localhost:3000>. Stop the development server with `Ctrl+C`.

## Verify the web package

```bash
pnpm --filter @katha/shared build
pnpm --filter @katha/web test
pnpm --filter @katha/web lint
pnpm --filter @katha/web typecheck
pnpm --filter @katha/web build
```

`typecheck` generates Next.js route types before invoking TypeScript. Next.js
builds use Turbopack by default. Generated route declarations and build output
remain local and are excluded from Git.

The [public API client](public-api-client.md) validates shared response contracts
and supplies route loading, error and not-found states. The artwork page uses
these boundaries; its integration check is `pnpm --filter @katha/web test:artwork-page`
after a production build.
