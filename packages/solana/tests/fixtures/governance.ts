import { prepareGovernanceSetup } from "../../src/governance-setup.js";
import {
  createNoopSigner,
  getAddressDecoder,
  generateKeyPairSigner,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import * as registry from "../../src/generated/registry/index.js";
import { governanceAccountMetas } from "../../src/governance.js";
import { setupMarketplaceConfiguration } from "./marketplace-configuration.js";
import { createSquads } from "./squads.js";

/** Genuine two-voter Squads execution, loader handover and governance activation. */
export async function setupGovernance() {
  const f = await setupMarketplaceConfiguration();
  await f.client.sendTransaction([await f.initialize(), await f.initializeFees()]);
  const squads = await createSquads(f.client, f.roles.bootstrap);
  const program = f.client.svm.getAccount(registry.KATHA_REGISTRY_PROGRAM_ADDRESS);
  if (!program.exists) throw new Error("Missing Registry");
  const registryData = getAddressDecoder().decode(program.data.subarray(4, 36));
  const authority = createNoopSigner(squads.vault);
  async function govern(
    instructions: Instruction[],
    signers: TransactionSigner[] = [],
  ) {
    const proposal = await squads.propose(instructions, signers);
    await proposal.approve();
    await proposal.approve(squads.members[1]!);
    return proposal.execute();
  }
  const operators = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  const plan = await prepareGovernanceSetup(
    {
      cluster: "devnet",
      multisig: squads.multisig,
      members: squads.memberAddresses,
      vaultIndex: 0,
      timeLockSeconds: 0,
      grants: [
        {
          wallet: operators[0]!.address,
          roles: ["catalog", "registrar", "inventorySales"],
          expiresAt: "0",
        },
        {
          wallet: operators[1]!.address,
          roles: ["artistVerifier", "artworkVerifier"],
          expiresAt: "0",
        },
        { wallet: operators[2]!.address, roles: ["custody"], expiresAt: "0" },
      ],
    },
    async (key) => f.client.svm.getAccount(key),
  );
  for (const group of plan.groups) {
    await govern(
      group.instructions.map((ix) => ({ ...ix, data: Uint8Array.from(ix.data) })),
      [f.roles.bootstrap, f.roles.seller],
    );
  }
  const [governance] = await registry.findGovernancePda();
  const extend = async (instruction: Instruction, wallet = f.roles.seller.address) => {
    const [grant] = await registry.findGrantPda({ wallet });
    return {
      ...instruction,
      accounts: [
        ...(instruction.accounts ?? []),
        ...governanceAccountMetas({
          governance,
          grant,
          registryConfig: f.registryConfig,
          wallet,
          roles: 0,
          pauses: 0,
          slot: 0n,
        }),
      ],
    };
  };
  async function grant(
    wallet: typeof f.roles.seller.address,
    roles: number,
    expiresAt = 0n,
  ) {
    await govern(
      [
        await registry.getCreateRoleGrantInstructionAsync({
          authority,
          payer: f.roles.bootstrap,
          wallet,
          roles,
          expiresAt,
        }),
      ],
      [f.roles.bootstrap],
    );
    return (await registry.findGrantPda({ wallet }))[0];
  }
  const bytes = (key: typeof governance) => {
    const account = f.client.svm.getAccount(key);
    if (!account.exists) throw new Error("Missing fixture account");
    return Uint8Array.from(account.data);
  };
  return {
    ...f,
    squads,
    authority,
    governance,
    registryData,
    govern,
    extend,
    grant,
    bytes,
    plan,
  };
}
