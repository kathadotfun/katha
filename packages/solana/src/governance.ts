import {
  AccountRole,
  address,
  fetchEncodedAccounts,
  type Address,
  type EncodedAccount,
  type GetMultipleAccountsApi,
  type Rpc,
  type Instruction,
} from "@solana/kit";
import * as registry from "./generated/registry/index.js";
import * as market from "./generated/marketplace/index.js";
import { assertOwnedEncodedAccount } from "./client.js";
import { OPERATOR_ROLES } from "@katha/shared";
export { OPERATOR_ROLES } from "@katha/shared";

export const REGISTRY_GOVERNANCE_SIZE = 8 + 1 + 5 * 32 + 8 + 1 + 4 + 76 * 64 + 1;
const CLOCK = address("SysvarC1ock11111111111111111111111111111111");
const SYSVAR = address("Sysvar1111111111111111111111111111111111111");

export interface OperatorAuthorization {
  governance: Address;
  grant: Address;
  registryConfig: Address;
  wallet: Address;
  roles: number;
  pauses: number;
  slot: bigint;
}

export function governanceAccountMetas(authorization: OperatorAuthorization) {
  return [
    authorization.governance,
    authorization.grant,
    authorization.registryConfig,
  ].map((key) => ({ address: key, role: AccountRole.READONLY }));
}

/** Only these exact read-only canonical accounts may extend the legacy manifest. */
export async function inspectGovernanceSuffix<T extends Instruction>(
  instruction: T,
  wallet: Address,
) {
  const [[governance], [grant], [config]] = await Promise.all([
    registry.findGovernancePda(),
    registry.findGrantPda({ wallet }),
    registry.findConfigPda(),
  ]);
  const accounts = instruction.accounts ?? [];
  if (accounts.at(-3)?.address !== governance) return { instruction, governed: false };
  const expected = [governance, grant, config];
  if (
    accounts
      .slice(-3)
      .some(
        (account, i) =>
          account.address !== expected[i] || account.role !== AccountRole.READONLY,
      )
  )
    throw new TypeError("Invalid governance account extension");
  return {
    instruction: { ...instruction, accounts: accounts.slice(0, -3) },
    governed: true,
  };
}

export async function readOperatorAuthorization(
  rpc: Rpc<GetMultipleAccountsApi>,
  wallet: Address,
): Promise<OperatorAuthorization> {
  const [
    [config, configBump],
    [governance, bump],
    [grant, grantBump],
    [collectionAuthority, collectionBump],
    [marketConfig],
  ] = await Promise.all([
    registry.findConfigPda(),
    registry.findGovernancePda(),
    registry.findGrantPda({ wallet }),
    registry.findCollectionAuthorityPda(),
    market.findConfigPda(),
  ]);
  const accounts = await fetchEncodedAccounts(rpc, [config, governance, grant, CLOCK], {
    commitment: "finalized",
    abortSignal: AbortSignal.timeout(5000),
  });
  const [configAccount, governanceAccount, grantAccount, clockAccount] = accounts;
  if (!configAccount?.exists || !governanceAccount?.exists || !clockAccount?.exists)
    throw new TypeError("Active governance is unavailable");
  assertOwnedEncodedAccount(
    configAccount,
    config,
    registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    registry.getKathaConfigSize(),
  );
  if (
    configAccount.executable ||
    configAccount.data.length !== registry.getKathaConfigSize() ||
    registry.identifyKathaRegistryAccount(configAccount.data) !==
      registry.KathaRegistryAccount.KathaConfig
  )
    throw new TypeError("Invalid Registry configuration");
  const configuration = registry.getKathaConfigDecoder().decode(configAccount.data);
  if (
    configuration.registrationAuthority !== governance ||
    configuration.bump !== configBump ||
    configuration.collectionAuthority !== collectionAuthority ||
    configuration.collectionAuthorityBump !== collectionBump
  )
    throw new TypeError("Governance is not active");
  assertOwnedEncodedAccount(
    governanceAccount,
    governance,
    registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    REGISTRY_GOVERNANCE_SIZE,
  );
  if (
    governanceAccount.executable ||
    governanceAccount.data.length !== REGISTRY_GOVERNANCE_SIZE ||
    registry.identifyKathaRegistryAccount(governanceAccount.data) !==
      registry.KathaRegistryAccount.RegistryGovernance ||
    new DataView(
      governanceAccount.data.buffer,
      governanceAccount.data.byteOffset,
    ).getUint32(178, true) > 64
  )
    throw new TypeError("Invalid governance allocation");
  const state = registry.getRegistryGovernanceDecoder().decode(governanceAccount.data);
  if (
    state.version !== 1 ||
    state.config !== config ||
    state.bump !== bump ||
    state.pauses & ~7 ||
    state.holds.length > 64 ||
    state.revision < 1n ||
    state.marketplaceProgram !== market.KATHA_MARKETPLACE_PROGRAM_ADDRESS ||
    state.marketplaceConfig !== marketConfig ||
    state.custodyIdentity !== configuration.custodyAuthority
  )
    throw new TypeError("Invalid governance binding");
  assertOwnedEncodedAccount(clockAccount, CLOCK, SYSVAR, 40);
  if (clockAccount.executable || clockAccount.data.length !== 40)
    throw new TypeError("Invalid chain clock");
  const clock = new DataView(
    clockAccount.data.buffer,
    clockAccount.data.byteOffset,
    40,
  );
  const now = clock.getBigInt64(32, true),
    slot = clock.getBigUint64(0, true);
  if (now <= 0n || slot > 0x7fff_ffff_ffff_ffffn)
    throw new TypeError("Invalid chain time or authorization slot");
  let roles = 0;
  if (grantAccount?.exists) {
    assertOwnedEncodedAccount(
      grantAccount,
      grant,
      registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      registry.getRoleGrantSize(),
    );
    if (
      grantAccount.executable ||
      grantAccount.data.length !== registry.getRoleGrantSize() ||
      registry.identifyKathaRegistryAccount(grantAccount.data) !==
        registry.KathaRegistryAccount.RoleGrant
    )
      throw new TypeError("Invalid operator grant allocation");
    const value = registry.getRoleGrantDecoder().decode(grantAccount.data);
    if (
      value.version !== 1 ||
      value.governance !== governance ||
      value.wallet !== wallet ||
      value.bump !== grantBump ||
      value.roles === 0 ||
      value.roles & ~127 ||
      value.revision < 1n ||
      value.expiresAt < 0n
    )
      throw new TypeError("Invalid operator grant");
    if (value.enabled && (value.expiresAt === 0n || value.expiresAt > now))
      roles = value.roles;
  }
  return Object.freeze({
    governance,
    grant,
    registryConfig: config,
    wallet,
    roles,
    pauses: state.pauses,
    slot,
  });
}

export async function assertRegistryOperator(
  context: {
    authorityAddress: Address;
    authorization?: OperatorAuthorization | undefined;
  },
  configuration: registry.KathaConfig,
  role: "registrationAuthority" | "verifierAuthority" | "custodyAuthority",
) {
  const [governance] = await registry.findGovernancePda();
  if (configuration.registrationAuthority !== governance) {
    if (configuration[role] !== context.authorityAddress)
      throw new TypeError(`Configured ${role} is required`);
    return;
  }
  // Snapshot readers use the stored identity to validate history without granting a
  // transaction privilege. Actual execution always checks the current grant on-chain.
  if (!context.authorization && context.authorityAddress === configuration[role])
    return;
  const bit = {
    registrationAuthority: OPERATOR_ROLES.registrar,
    verifierAuthority: OPERATOR_ROLES.artworkVerifier,
    custodyAuthority: OPERATOR_ROLES.custody,
  }[role];
  if (
    !context.authorization ||
    context.authorization.wallet !== context.authorityAddress ||
    context.authorization.governance !== governance ||
    !(context.authorization.roles & bit) ||
    context.authorization.pauses & 1
  )
    throw new TypeError(`Current ${role} grant is required`);
}

export async function isGovernedConfiguration(account: EncodedAccount) {
  return (
    registry.getKathaConfigDecoder().decode(account.data).registrationAuthority ===
    (await registry.findGovernancePda())[0]
  );
}
