# Workspace task orchestration

The root `turbo.json` defines the task graph for the pnpm workspace. Package
manifests own their commands; the root scripts delegate workspace work to Turbo.
Add a package task when that package first gains the corresponding application,
test, or build tooling.

| Root command        | Task behavior                                                                    |
| ------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`          | Run available package development servers; persistent tasks are not cached.      |
| `pnpm build`        | Build packages after their workspace dependencies; cache declared build outputs. |
| `pnpm lint`         | Run package lint tasks and the root ESLint configuration check.                  |
| `pnpm typecheck`    | Typecheck packages in workspace dependency order.                                |
| `pnpm test`         | Build packages before their tests; run the shared identity test suite.           |
| `pnpm format:check` | Check formatting across supported public files; runs directly through Prettier.  |

The root lint task checks `eslint.config.mjs`; package `lint` scripts check their own
source. Lint and typecheck tasks cache logs but no file outputs. Build tasks cache
`.next`, `dist`, and `build` output while excluding `.next/cache`. Test tasks cache logs without file outputs; no coverage or report artifacts are
generated yet. Development servers are persistent and uncached.

The shared TypeScript presets are `globalDependencies`, so changing compiler rules
invalidates dependent task caches. No environment variables are included globally.
Add only the values a package actually needs to that task's `env` or
`passThroughEnv`, following the package's trust boundary. No remote cache or cache
credentials are configured.

The shared package currently provides the only test task. Run
`pnpm exec turbo run <task> --dry=json` to inspect the planned package task graph.

See the official [Turborepo task guide](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks),
[configuration reference](https://turborepo.dev/docs/reference/configuration),
and [task-running guide](https://turborepo.dev/docs/crafting-your-repository/running-tasks).
