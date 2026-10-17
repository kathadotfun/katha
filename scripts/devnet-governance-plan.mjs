import process from "node:process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareGovernanceSetup } from "../packages/solana/dist/index.js";
import { checkDevnet, readPublicDevnetAccount } from "./devnet-check.mjs";

async function main() {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  if (args.length !== 1)
    throw new Error("Usage: pnpm devnet:governance:plan -- PUBLIC_INPUT.json");
  const input = JSON.parse(await readFile(resolve(args[0]), "utf8"));
  const readiness = await checkDevnet();
  const plan = await prepareGovernanceSetup(input, readPublicDevnetAccount);
  process.stdout.write(
    JSON.stringify(
      { ...plan, readiness },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ) + "\n",
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(
      "Governance review failed. Check public inputs, live Squad members/delay, initialized configs and built binaries. No transaction was signed or sent.\n",
    );
    process.exitCode = 1;
  });
}
