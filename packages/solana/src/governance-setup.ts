import { governanceSetupSchema, OPERATOR_ROLES, sha256Hex } from "@katha/shared";
import {
  AccountRole,
  address,
  createNoopSigner,
  type Instruction,
  type MaybeEncodedAccount,
  type Address,
} from "@solana/kit";
import * as registry from "./generated/registry/index.js";
import * as market from "./generated/marketplace/index.js";
import { readRegistryConfiguration } from "./registration.js";
import { assertOwnedEncodedAccount } from "./client.js";
import {
  inspectUpgradeableProgram,
  findUpgradeableProgramDataAddress,
} from "./program-upgrade.js";
import { inspectSquadsVault, compileSquadsMessage } from "./squads.js";

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
type ProposalReview = {
  name: string;
  messageSha256: string;
  messageBytes: number[];
  requiredExecutionSigners: Address[];
  instructions: {
    programAddress: Address;
    accounts: { address: Address; role: AccountRole }[];
    data: number[];
  }[];
};
export async function prepareGovernanceSetup(
  input: unknown,
  read: (key: Address) => Promise<MaybeEncodedAccount>,
) {
  const setup = governanceSetupSchema.parse(input);
  const [[config], [marketConfig], [governance]] = await Promise.all([
    registry.findConfigPda(),
    market.findConfigPda(),
    registry.findGovernancePda(),
  ]);
  const account = await read(address(setup.multisig));
  if (!account.exists) throw new TypeError("Create and verify the Devnet Squad first");
  const squad = await inspectSquadsVault(account, setup.vaultIndex);
  if (
    squad.timeLock !== setup.timeLockSeconds ||
    setup.members.some((key) => !squad.members.includes(address(key)))
  )
    throw new TypeError("The live Squad differs from the reviewed members or delay");
  if ((await read(governance)).exists)
    throw new TypeError("Governance already exists; do not initialize it again");
  const configAccount = await read(config);
  if (!configAccount.exists) throw new TypeError("Registry must be initialized");
  const { state: platform } = await readRegistryConfiguration(configAccount);
  const marketAccount = await read(marketConfig);
  assertOwnedEncodedAccount(
    marketAccount,
    marketConfig,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    market.getMarketplaceConfigSize(),
  );
  if (
    marketAccount.executable ||
    marketAccount.data.length !== market.getMarketplaceConfigSize() ||
    market.identifyKathaMarketplaceAccount(marketAccount.data) !==
      market.KathaMarketplaceAccount.MarketplaceConfig
  )
    throw new TypeError("Invalid Marketplace configuration");
  const marketplace = market.getMarketplaceConfigDecoder().decode(marketAccount.data);
  if (
    marketplace.version !== 1 ||
    marketplace.registryProgram !== registry.KATHA_REGISTRY_PROGRAM_ADDRESS ||
    marketplace.registryConfig !== config ||
    marketplace.collection !== platform.collection
  )
    throw new TypeError("Unexpected or already staged Marketplace");
  const authority = createNoopSigner(squad.vault);
  const handover: Instruction[] = [];
  const programData = new Map<Address, Address>();
  const programs = [];
  for (const program of [
    registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  ]) {
    const data = await findUpgradeableProgramDataAddress(program);
    const snapshot = await inspectUpgradeableProgram(
      program,
      await read(program),
      await read(data),
    );
    programs.push(snapshot);
    programData.set(program, data);
    if (snapshot.authority !== squad.vault)
      handover.push({
        programAddress: LOADER,
        data: Uint8Array.of(4, 0, 0, 0),
        accounts: [
          { address: data, role: AccountRole.WRITABLE },
          { address: snapshot.authority, role: AccountRole.READONLY_SIGNER },
          { address: squad.vault, role: AccountRole.READONLY },
        ],
      });
  }
  if (platform.authority !== squad.vault)
    handover.push(
      await registry.getTransferMultisigAuthorityInstructionAsync({
        authority: createNoopSigner(platform.authority),
        newAuthority: authority,
        multisig: squad.multisig,
        programData: programData.get(registry.KATHA_REGISTRY_PROGRAM_ADDRESS)!,
        expectedAuthority: platform.authority,
        vaultIndex: squad.vaultIndex,
        expectedMembers: squad.members,
        expectedTimeLock: squad.timeLock,
      }),
    );
  if (marketplace.authority !== squad.vault)
    handover.push(
      await market.getTransferMultisigAuthorityInstructionAsync({
        authority: createNoopSigner(marketplace.authority),
        newAuthority: authority,
        multisig: squad.multisig,
        programData: programData.get(market.KATHA_MARKETPLACE_PROGRAM_ADDRESS)!,
        expectedAuthority: marketplace.authority,
        vaultIndex: squad.vaultIndex,
        expectedMembers: squad.members,
        expectedTimeLock: squad.timeLock,
      }),
    );
  const activation = [
    await market.getStageGovernanceInstructionAsync({
      authority,
      registryConfig: config,
      programData: programData.get(market.KATHA_MARKETPLACE_PROGRAM_ADDRESS)!,
    }),
    await registry.getActivateGovernanceInstructionAsync({
      authority,
      payer: authority,
      multisig: squad.multisig,
      programData: programData.get(registry.KATHA_REGISTRY_PROGRAM_ADDRESS)!,
      marketplaceProgram: market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      marketplaceProgramData: programData.get(
        market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      )!,
      marketplaceConfig: marketConfig,
      vaultIndex: squad.vaultIndex,
      expectedMembers: squad.members,
      expectedTimeLock: squad.timeLock,
    }),
  ];
  const groups: ProposalReview[] = [];
  async function group(name: string, instructions: Instruction[]) {
    const compiled = compileSquadsMessage(squad.vault, instructions);
    // Keep initial proposal creation within a conservative one-transaction bound.
    // Larger governance messages need an explicit buffer-based proposal workflow.
    if (compiled.message.length > 750)
      throw new TypeError(
        "Governance proposal needs explicit message-buffer preparation",
      );
    groups.push({
      name,
      messageSha256: await sha256Hex(compiled.message),
      messageBytes: [...compiled.message],
      requiredExecutionSigners: compiled.requiredExecutionSigners,
      instructions: instructions.map((ix) => ({
        programAddress: ix.programAddress,
        accounts: (ix.accounts ?? []).map(({ address, role }) => ({ address, role })),
        data: [...(ix.data ?? [])],
      })),
    });
  }
  if (handover.length) await group("atomic-loader-and-root-handover", handover);
  await group("atomic-marketplace-stage-and-registry-activation", activation);
  for (const grant of setup.grants)
    await group(`grant-${grant.wallet}`, [
      await registry.getCreateRoleGrantInstructionAsync({
        authority,
        payer: authority,
        wallet: address(grant.wallet),
        roles: grant.roles.reduce((bits, role) => bits | OPERATOR_ROLES[role], 0),
        expiresAt: BigInt(grant.expiresAt),
      }),
    ]);
  return {
    mode: "review-only" as const,
    cluster: "devnet" as const,
    squad,
    programs,
    governance,
    custodyIdentity: platform.custodyAuthority,
    legacyRegistrar: platform.registrationAuthority,
    grants: setup.grants,
    groups,
    restrictions: [
      "No signing, submission or keypair access occurs",
      "Approve binary upgrades before these program instructions",
      "Fund the vault for governance/role account rent",
      "Handover execution requires every listed current-authority co-signer",
      "Do not cut over before reviewing outstanding ADR migration requirements",
      "Execute each reviewed group atomically through genuine Squads",
    ],
  };
}
