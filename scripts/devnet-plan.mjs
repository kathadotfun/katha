import process from "node:process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import { devnetBootstrapSchema } from "../packages/shared/dist/index.js";
import * as registry from "../packages/solana/dist/generated/registry/index.js";
import * as marketplace from "../packages/solana/dist/generated/marketplace/index.js";

export async function createDevnetDeploymentPlan(input) {
  const config = devnetBootstrapSchema.parse(input);
  const [registryConfig] = await registry.findConfigPda();
  const [collectionAuthority] = await registry.findCollectionAuthorityPda();
  const [marketplaceConfig] = await marketplace.findConfigPda();
  const [feeSchedule] = await marketplace.findFeeSchedulePda();
  return {
    mode: "review-only",
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    toolchain: { node: "24.21.0", pnpm: "12.6.0", anchor: "1.2.0", solana: "4.1.2" },
    publicInputs: config,
    programs: {
      registry: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      marketplace: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    },
    addresses: { registryConfig, collectionAuthority, marketplaceConfig, feeSchedule },
    deployment: [
      {
        name: "registry",
        binary: "target/deploy/katha_registry.so",
        expectedProgramId: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      },
      {
        name: "marketplace",
        binary: "target/deploy/katha_marketplace.so",
        expectedProgramId: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      },
    ],
    operatorPage: "/admin/devnet",
    order: [
      "build/check binaries and public program IDs",
      "operator deploys both upgradeable programs",
      "operator creates classic SPL six-decimal test mint without freeze authority",
      "approve Core collection creation",
      "approve Registry initialization",
      "approve Marketplace initialization",
      "approve fee schedule initialization before creating listings",
      "configure matching API/web/indexer Devnet settings",
      "register artwork through existing admin workflow",
      "approve immutable artist payout binding",
      "fund collector test token accounts",
    ],
    defaults: {
      feeRates: config.feeRates,
      commissionBps: 250,
      secondaryRoyaltyBps: 500,
      inspectionValiditySeconds: "2592000",
    },
    restrictions: [
      "No deployment, signing, RPC mutation or keypair reading is performed by this command",
      "Both program upgrade authorities and Registry platform authority must match operator for this single-wallet bootstrap utility",
      "Prepared instructions require explicit wallet approval; unknown signatures must be checked before replacement",
      "Collection and mint addresses are operator choices; this plan is not proof they exist on Devnet",
    ],
  };
}

async function main() {
  const supplied = process.argv.slice(2);
  const args = supplied[0] === "--" ? supplied.slice(1) : supplied;
  if (args.length !== 1 || args[0] === "--help") {
    process.stdout.write(
      "Usage: pnpm devnet:plan -- helper/devnet/bootstrap.json\nRead-only plan using public JSON inputs. Run pnpm build first.\n",
    );
    if (args[0] !== "--help") process.exitCode = 1;
    return;
  }
  const input = JSON.parse(await readFile(resolve(args[0]), "utf8"));
  const plan = await createDevnetDeploymentPlan(input);
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const program of plan.deployment) {
    const bytes = await readFile(resolve(root, program.binary));
    if (bytes.length < 4 || bytes.subarray(0, 4).toString("hex") !== "7f454c46")
      throw new Error("Build a valid SBF ELF before reviewing deployment");
    Object.assign(program, {
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write(
      "Devnet plan failed. Check public JSON schema and built SBF binaries; no deployment was attempted.\n",
    );
    process.exitCode = 1;
  });
}
