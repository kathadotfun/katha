/* global AbortSignal */
import process from "node:process";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import {
  inspectUpgradeableProgram,
  findUpgradeableProgramDataAddress,
  readRegistryAuthorities,
  createKathaRpcClient,
  retryRpcRead,
} from "../packages/solana/dist/index.js";
import { readMarketplaceFeeSchedule } from "../packages/solana/dist/marketplace.js";
import * as registry from "../packages/solana/dist/generated/registry/index.js";
import * as market from "../packages/solana/dist/generated/marketplace/index.js";

const endpoint = "https://api.devnet.solana.com";
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const loader = "BPFLoaderUpgradeab1e11111111111111111111111";
const client = createKathaRpcClient({ cluster: "devnet" });
async function rpc(method, params) {
  if (!["getGenesisHash", "getAccountInfo", "getSlot"].includes(method))
    throw new Error("Unsupported read-only Devnet RPC method");
  return retryRpcRead(() =>
    client.rpc[method](...params).send({ abortSignal: AbortSignal.timeout(20000) }),
  );
}
function publicInteger(value) {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error("Invalid public RPC integer");
  return number;
}
function account(key, value) {
  if (value === null) return { address: key, exists: false };
  if (
    !value ||
    !Array.isArray(value.data) ||
    value.data.length !== 2 ||
    value.data[1] !== "base64" ||
    typeof value.data[0] !== "string" ||
    typeof value.executable !== "boolean" ||
    typeof value.owner !== "string"
  )
    throw new Error("Invalid public RPC account");
  const data = Buffer.from(value.data[0], "base64");
  if (data.toString("base64") !== value.data[0] || data.length > 16 * 1024 * 1024)
    throw new Error("Invalid account encoding");
  return {
    address: key,
    exists: true,
    programAddress: value.owner,
    executable: value.executable,
    lamports: BigInt(publicInteger(value.lamports)),
    space: BigInt(data.length),
    data: new Uint8Array(data),
  };
}
export async function readPublicDevnetAccount(key) {
  const result = await rpc("getAccountInfo", [
    key,
    { encoding: "base64", commitment: "finalized" },
  ]);
  if (!result.context) throw new Error("Missing finalized account slot");
  publicInteger(result.context.slot);
  return account(key, result.value);
}
const read = readPublicDevnetAccount;

/** Public RPC and .so files only. Never read CLI config, environment files or keys. */
export async function checkDevnet() {
  if ((await rpc("getGenesisHash", [])) !== genesis)
    throw new Error("Devnet genesis mismatch");
  const [[config], [marketConfig], [governance], [feeSchedule]] = await Promise.all([
    registry.findConfigPda(),
    market.findConfigPda(),
    registry.findGovernancePda(),
    market.findFeeSchedulePda(),
  ]);
  const root = fileURLToPath(new URL("../", import.meta.url));
  const programs = [];
  for (const [name, key] of [
    ["registry", registry.KATHA_REGISTRY_PROGRAM_ADDRESS],
    ["marketplace", market.KATHA_MARKETPLACE_PROGRAM_ADDRESS],
  ]) {
    const program = await read(key);
    if (
      !program.exists ||
      program.programAddress !== loader ||
      program.data.length !== 36
    )
      throw new Error("Program is absent or not loader-v3");
    const dataKey = await findUpgradeableProgramDataAddress(key);
    const binary = await readFile(resolve(root, `target/deploy/katha_${name}.so`));
    programs.push({
      name,
      binary: `target/deploy/katha_${name}.so`,
      ...(await inspectUpgradeableProgram(key, program, await read(dataKey), binary)),
    });
  }
  const [registryAccount, marketAccount, governanceAccount, feesAccount] =
    await Promise.all([
      read(config),
      read(marketConfig),
      read(governance),
      read(feeSchedule),
    ]);
  const authorities = registryAccount.exists
    ? await readRegistryAuthorities(registryAccount)
    : null;
  let marketplace = null;
  if (marketAccount.exists) {
    if (
      marketAccount.programAddress !== market.KATHA_MARKETPLACE_PROGRAM_ADDRESS ||
      marketAccount.executable ||
      marketAccount.data.length !== market.getMarketplaceConfigSize() ||
      market.identifyKathaMarketplaceAccount(marketAccount.data) !==
        market.KathaMarketplaceAccount.MarketplaceConfig
    )
      throw new Error("Invalid Marketplace configuration");
    marketplace = market.getMarketplaceConfigDecoder().decode(marketAccount.data);
    if (
      ![1, 2].includes(marketplace.version) ||
      marketplace.registryConfig !== config ||
      marketplace.registryProgram !== registry.KATHA_REGISTRY_PROGRAM_ADDRESS
    )
      throw new Error("Foreign Marketplace binding");
  }
  const fees = feesAccount.exists
    ? await readMarketplaceFeeSchedule(feesAccount)
    : null;
  const active =
    authorities?.registrationAuthority === governance &&
    marketplace?.version === 2 &&
    governanceAccount.exists;
  if (active) {
    if (
      governanceAccount.programAddress !== registry.KATHA_REGISTRY_PROGRAM_ADDRESS ||
      governanceAccount.executable ||
      registry.identifyKathaRegistryAccount(governanceAccount.data) !==
        registry.KathaRegistryAccount.RegistryGovernance
    )
      throw new Error("Invalid governance account");
    const state = registry
      .getRegistryGovernanceDecoder()
      .decode(governanceAccount.data);
    if (
      state.version !== 1 ||
      state.config !== config ||
      state.marketplaceConfig !== marketConfig ||
      state.marketplaceProgram !== market.KATHA_MARKETPLACE_PROGRAM_ADDRESS ||
      marketplace.authority !== authorities.authority ||
      programs.some((p) => p.authority !== authorities.authority)
    )
      throw new Error("Inconsistent governance and upgrade authorities");
  }
  return {
    mode: "read-only",
    cluster: "devnet",
    rpcUrl: endpoint,
    genesis,
    observedFinalizedSlot: publicInteger(
      await rpc("getSlot", [{ commitment: "finalized" }]),
    ),
    programs,
    accounts: {
      registryConfig: config,
      marketplaceConfig: marketConfig,
      governance,
      feeSchedule,
    },
    authorities,
    marketplace,
    fees,
    governanceMarkerActive: active,
    binariesMatchDevnet: programs.every((program) => program.matchesLocal),
    acceptance:
      "Wallet approvals, role grants, purchases, physical inspection and NFC acceptance require separate finalized evidence",
    nextActions: [
      ...(programs.some((p) => !p.matchesLocal)
        ? [
            "Upload and review both changed binaries; approve upgrades with the current public authority",
          ]
        : []),
      ...(!fees ? ["Initialize the fee schedule before new listings"] : []),
      ...(!active
        ? [
            "Create the independent 2-of-3 Squad and review the coordinated governance cutover",
          ]
        : []),
      "Existing initialized singleton accounts must not be initialized again after an upgrade",
      "Run the full two-collector Devnet acceptance guide and record finalized receipts",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: pnpm devnet:check");
  checkDevnet()
    .then((result) =>
      process.stdout.write(
        JSON.stringify(
          result,
          (_, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ) + "\n",
      ),
    )
    .catch(() => {
      process.stderr.write(
        "Devnet check failed; verify built packages, SBF binaries and public RPC availability. No transaction was sent.\n",
      );
      process.exitCode = 1;
    });
}
