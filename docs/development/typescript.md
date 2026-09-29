# TypeScript configuration

The root workspace pins TypeScript 6.0.3. Extend one of the shared configurations
from each package; keep package-specific `include`, `exclude`, `rootDir`, and
`outDir` settings in that package rather than the shared presets.

| Preset | Use | Runtime libraries and module resolution |
|---|---|---|
| `tsconfig.base.json` | Environment-neutral strict defaults | ES2024 only; no ambient type packages |
| `tsconfig.node.json` | Node services, scripts, and server packages | NodeNext; Node declarations must be installed by the consuming package |
| `tsconfig.web.json` | Browser application and browser-only packages | Bundler; DOM and React declarations must be installed by the consuming package |

All presets disable emit and enable strict checking, exact optional properties,
checked indexed access, explicit type-only imports/exports, and consistent file
casing. The base preset intentionally has no browser globals. A package that uses
Node globals should extend `tsconfig.node.json`; a package using browser APIs should
extend `tsconfig.web.json`. Keep Node-only imports out of browser packages.

The Node preset uses Node's ESM-aware `NodeNext` rules. A Node package should set
`"type": "module"` in its own `package.json` when its sources are ESM; module
interpretation follows the nearest package manifest. The web preset selects the
automatic React JSX transform. Install React's runtime and declaration packages
in the consuming web package when it is scaffolded.

The configs specify target, libraries, module mode, and type packages explicitly
so compiler upgrades do not silently change their environment. See the official
[TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html),
[compiler-options guide](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options),
and [TSConfig reference](https://www.typescriptlang.org/tsconfig/).
