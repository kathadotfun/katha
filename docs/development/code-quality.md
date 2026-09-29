# Linting and formatting

The root workspace pins ESLint 10.11.0, `@eslint/js` 10.0.1,
`typescript-eslint` 8.70.1, and Prettier 3.9.9. ESLint uses flat configuration
with the recommended JavaScript and TypeScript rules. Prettier owns formatting;
ESLint does not add a competing style rule set.

Run the non-writing checks from the repository root:

```bash
pnpm lint
pnpm format:check
```

The explicit write commands are separate:

```bash
pnpm lint:fix
pnpm format:write
```

Review the diff after any write command. The lint and format checks do not modify
files. Prettier checks supported public files, including project documentation and
configuration; the lockfile is managed by pnpm and is excluded from formatting.

Both tools exclude local `helper/`, `AGENTS.md`, source logo folders, and local
agent directories. They also exclude installed dependencies, framework/build/cache
directories, compiled Rust `target` directories, and generated source output. Keep
the exclusions aligned if generated code moves; generated clients must still be
checked by their owning deterministic generation and compile steps.

Configuration lives in `eslint.config.mjs`, `.prettierrc.json`, and
`.prettierignore`. See the official [ESLint flat configuration guide](https://eslint.org/docs/latest/use/configure/configuration-files),
[typescript-eslint setup](https://typescript-eslint.io/getting-started/),
[Prettier CLI](https://prettier.io/docs/cli), and
[Prettier ignore rules](https://prettier.io/docs/ignore).
