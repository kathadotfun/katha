import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor } from "@codama/renderers-js";
import { createFromRoot } from "codama";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const programs = ["registry", "marketplace"];
const prettierOptions = JSON.parse(
  await readFile(join(root, ".prettierrc.json"), "utf8"),
);
delete prettierOptions.$schema;
const check = process.argv[2] === "--check";
if (process.argv.length > 3 || (process.argv[2] && !check)) {
  throw new Error("Usage: node scripts/generate-program-clients.mjs [--check]");
}

async function files(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(join(directory, prefix), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const result = [];
  for (const entry of entries) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await files(directory, name)));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unexpected generated entry: ${name}`);
  }
  return result.sort();
}

const temporary = await mkdtemp(join(tmpdir(), "katha-codegen-"));
try {
  const changes = [];
  for (const program of programs) {
    const idl = JSON.parse(
      await readFile(join(root, "target/idl", `katha_${program}.json`), "utf8"),
    );
    if (idl.metadata.name !== `katha_${program}`) {
      throw new Error(`Unexpected program name in ${program} IDL`);
    }
    const output = join(temporary, program);
    await createFromRoot(rootNodeFromAnchor(idl)).accept(
      renderVisitor(temporary, {
        generatedFolder: program,
        importExtension: "js",
        kitImportStrategy: "rootOnly",
        syncPackageJson: false,
        formatCode: false,
      }),
    );
    for (const name of await files(output)) {
      const path = join(output, name);
      await writeFile(
        path,
        await format(await readFile(path, "utf8"), {
          ...prettierOptions,
          parser: "typescript",
        }),
      );
    }
    const destination = join(root, "packages/solana/src/generated", program);
    if (check) {
      const expected = await files(output);
      const actual = await files(destination);
      for (const name of [...new Set([...expected, ...actual])].sort()) {
        if (
          !expected.includes(name) ||
          !actual.includes(name) ||
          !(await readFile(join(output, name))).equals(
            await readFile(join(destination, name)),
          )
        ) {
          changes.push(`packages/solana/src/generated/${program}/${name}`);
        }
      }
    } else {
      // Replace the complete generated directory so removed IDL items cannot linger.
      await rm(destination, { recursive: true, force: true });
      await cp(output, destination, { recursive: true });
      process.stdout.write(`Generated ${program} client\n`);
    }
  }
  if (changes.length > 0) {
    throw new Error(
      `Generated clients are stale; run pnpm codegen:\n${changes.join("\n")}`,
    );
  }
  if (check) process.stdout.write("Generated clients match both reviewed IDLs\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
