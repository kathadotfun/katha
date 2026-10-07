import { expect, it } from "vitest";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  lamports,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createMarketplaceFixture } from "./fixtures/marketplace.js";
import * as marketplace from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

async function setup() {
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
  return { ...f, config, bump, registryConfig, programDataAddress, initialize };
}

it("initializes one immutable marketplace config through both authorities and rejects duplicate takeover", async () => {
  const f = await setup();
  await f.client.sendTransaction([await f.initialize()]);
  const account = f.client.svm.getAccount(f.config);
  if (!account.exists) throw new Error("Missing Marketplace config");
  expect(account.programAddress).toBe(marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS);
  expect(account.data.length).toBe(247);
  expect(marketplace.getMarketplaceConfigDecoder().decode(account.data)).toMatchObject({
    version: 1,
    authority: f.roles.bootstrap.address,
    registryProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    registryConfig: f.registryConfig,
    collection: f.collection,
    treasury: f.roles.treasury.address,
    paymentMint: f.mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    paymentDecimals: 6,
    commissionBps: 250,
    secondaryRoyaltyBps: 500,
    inspectionValiditySeconds: 2_592_000n,
    bump: f.bump,
  });
  f.client.svm.expireBlockhash();
  await expect(f.client.sendTransaction([await f.initialize()])).rejects.toThrow();
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([
      await f.initialize({ authority: f.roles.outsider, paymentMint: f.wrongMint }),
    ]),
  ).rejects.toThrow();
  expect(f.client.svm.getAccount(f.config)).toEqual(account);
}, 30_000);

it("rejects wrong authorities, missing signature, forged config/ProgramData and unsupported payment accounts without leaving configuration", async () => {
  const f = await setup();
  const rejects = async (
    overrides: Partial<marketplace.InitializeMarketplaceAsyncInput>,
  ) => {
    f.client.svm.expireBlockhash();
    await expect(
      f.client.sendTransaction([await f.initialize(overrides)]),
    ).rejects.toThrow();
    expect(f.client.svm.getAccount(f.config).exists).toBe(false);
  };
  await rejects({ bootstrapAuthority: f.roles.outsider });
  await rejects({ authority: f.roles.outsider });
  await rejects({ program: registry.KATHA_REGISTRY_PROGRAM_ADDRESS });
  await rejects({ registryProgram: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS });
  const missingSignature = await f.initialize();
  await expect(
    f.client.sendTransaction([
      {
        ...missingSignature,
        accounts: missingSignature.accounts.map((account) =>
          account.address === f.roles.seller.address
            ? { address: account.address, role: AccountRole.WRITABLE }
            : account,
        ),
      },
    ]),
  ).rejects.toThrow();
  expect(f.client.svm.getAccount(f.config).exists).toBe(false);

  const programData = f.client.svm.getAccount(f.programDataAddress);
  if (!programData.exists) throw new Error("Missing ProgramData");
  const forged = await generateKeyPairSigner();
  f.client.svm.setAccount({ ...programData, address: forged.address });
  await rejects({ programData: forged.address });
  await rejects({ programData: f.registryConfig });
  const registryConfig = f.client.svm.getAccount(f.registryConfig);
  if (!registryConfig.exists) throw new Error("Missing Registry config");
  const cloned = await generateKeyPairSigner();
  f.client.svm.setAccount({ ...registryConfig, address: cloned.address });
  await rejects({ registryConfig: cloned.address });
  f.client.svm.setAccount({
    ...registryConfig,
    programAddress: address("11111111111111111111111111111111"),
  });
  await rejects({});
  f.client.svm.setAccount(registryConfig);
  const registryValue = registry.getKathaConfigDecoder().decode(registryConfig.data);
  f.client.svm.setAccount({
    ...registryConfig,
    data: new Uint8Array(
      registry.getKathaConfigEncoder().encode({
        ...registryValue,
        treasury: address("11111111111111111111111111111111"),
      }),
    ),
  });
  await rejects({});
  f.client.svm.setAccount(registryConfig);

  await rejects({ paymentMint: f.wrongDecimalsMint });
  await rejects({ paymentMint: f.tokenAccounts.buyerA });
  await rejects({ paymentMint: f.roles.outsider.address });
  const token2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  await rejects({ tokenProgram: token2022 });
  const mint = f.client.svm.getAccount(f.mint);
  if (!mint.exists) throw new Error("Missing mint");
  f.client.svm.setAccount({ ...mint, programAddress: token2022 });
  await rejects({});
  f.client.svm.setAccount({ ...mint, data: new Uint8Array(82) });
  await rejects({});
  f.client.svm.setAccount(mint);
  const freezeMint = await generateKeyPairSigner();
  await f.client.token.instructions
    .createMint({
      newMint: freezeMint,
      decimals: 6,
      mintAuthority: f.roles.bootstrap.address,
      freezeAuthority: f.roles.bootstrap.address,
    })
    .sendTransaction();
  await rejects({ paymentMint: freezeMint.address });
  // Fresh blockhash ensures the valid retry executes instead of hitting replay protection.
  f.client.svm.expireBlockhash();
  // All preceding failures leave the canonical PDA available to the genuine initializer.
  await f.client.sendTransaction([await f.initialize()]);
  expect(f.client.svm.getAccount(f.config).exists).toBe(true);
}, 30_000);

it("rejects excessive deductions and invalid inspection validity while accepting inclusive fee boundaries", async () => {
  const f = await setup();
  for (const overrides of [
    { commissionBps: 10_000, secondaryRoyaltyBps: 1 },
    { commissionBps: 65_535, secondaryRoyaltyBps: 65_535 },
    { inspectionValiditySeconds: 0n },
    { inspectionValiditySeconds: 18_446_744_073_709_551_615n },
  ]) {
    f.client.svm.expireBlockhash();
    await expect(
      f.client.sendTransaction([await f.initialize(overrides)]),
    ).rejects.toThrow();
    expect(f.client.svm.getAccount(f.config).exists).toBe(false);
  }
  await f.client.sendTransaction([
    await f.initialize({
      commissionBps: 10_000,
      secondaryRoyaltyBps: 0,
      inspectionValiditySeconds: 1n,
    }),
  ]);
  const account = f.client.svm.getAccount(f.config);
  if (!account.exists) throw new Error("Missing config");
  expect(marketplace.getMarketplaceConfigDecoder().decode(account.data)).toMatchObject({
    commissionBps: 10_000,
    secondaryRoyaltyBps: 0,
    inspectionValiditySeconds: 1n,
  });
}, 30_000);
