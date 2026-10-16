import { getAddressDecoder, getAddressEncoder, lamports } from "@solana/kit";
import { createMarketplaceFixture } from "./marketplace.js";
import * as marketplace from "../../src/generated/marketplace/index.js";
import * as registry from "../../src/generated/registry/index.js";

export async function setupMarketplaceConfiguration() {
  const binary = process.env.KATHA_TEST_MARKETPLACE_SO;
  if (!binary) throw new Error("Run pnpm program:test");
  const f = await createMarketplaceFixture();
  const programAddress = marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS;
  f.client.svm.addProgramFromFile(programAddress, binary);
  const program = f.client.svm.getAccount(programAddress);
  if (!program.exists) throw new Error("Missing marketplace program");
  const programDataAddress = getAddressDecoder().decode(program.data.subarray(4, 36));
  const programData = f.client.svm.getAccount(programDataAddress);
  if (!programData.exists || programData.data[12] !== 0)
    throw new Error("Unexpected ProgramData");
  // Distinct synthetic upgrade and Registry authorities prove both approvals are required.
  const data = new Uint8Array(programData.data.length + 32);
  data.set(programData.data.subarray(0, 12));
  data[12] = 1;
  data.set(getAddressEncoder().encode(f.roles.seller.address), 13);
  data.set(programData.data.subarray(13), 45);
  f.client.svm.setAccount({
    ...programData,
    data,
    space: BigInt(data.length),
    lamports: lamports(programData.lamports + 1_000_000n),
  });
  const [config, bump] = await marketplace.findConfigPda();
  const [registryConfig] = await registry.findConfigPda();
  const initialize = (
    overrides: Partial<marketplace.InitializeMarketplaceAsyncInput> = {},
  ) =>
    marketplace.getInitializeMarketplaceInstructionAsync({
      bootstrapAuthority: f.roles.seller,
      programData: programDataAddress,
      authority: f.roles.bootstrap,
      paymentMint: f.mint,
      commissionBps: f.settings.commissionBps,
      secondaryRoyaltyBps: f.settings.secondaryRoyaltyBps,
      inspectionValiditySeconds: f.settings.inspectionValiditySeconds,
      ...overrides,
    });
  const [feeSchedule] = await marketplace.findFeeSchedulePda();
  const [listing] = await marketplace.findListingPda({ asset: f.artwork.asset });
  const [listingFees] = await marketplace.findListingFeesPda({ listing });
  const initializeFees = (
    overrides: Partial<marketplace.InitializeFeeScheduleAsyncInput> = {},
  ) =>
    marketplace.getInitializeFeeScheduleInstructionAsync({
      authority: f.roles.bootstrap,
      primaryCommissionBps: 1000,
      secondaryCommissionBps: f.settings.commissionBps,
      secondaryRoyaltyBps: f.settings.secondaryRoyaltyBps,
      ...overrides,
    });
  return {
    ...f,
    config,
    bump,
    registryConfig,
    programDataAddress,
    initialize,
    initializeFees,
    feeSchedule,
    listingFees,
  };
}
