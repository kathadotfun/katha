import { expect, it } from "vitest";
import {
  AccountRole,
  createNoopSigner,
  getAddressDecoder,
  getAddressEncoder,
  lamports,
  type Instruction,
} from "@solana/kit";
import * as registry from "../src/generated/registry/index.js";
import * as marketplace from "../src/generated/marketplace/index.js";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import { createSquads, SQUADS, transferUpgradeAuthority } from "./fixtures/squads.js";

async function setup(options: Parameters<typeof createSquads>[2] = {}) {
  const f = await setupMarketplaceConfiguration();
  await f.client.sendTransaction([await f.initialize(), await f.initializeFees()]);
  const squads = await createSquads(f.client, f.roles.bootstrap, options);
  const program = f.client.svm.getAccount(registry.KATHA_REGISTRY_PROGRAM_ADDRESS);
  if (!program.exists) throw new Error("Missing Registry program");
  const registryData = getAddressDecoder().decode(program.data.subarray(4, 36));
  const instructions = async (
    overrides: Partial<registry.TransferMultisigAuthorityAsyncInput> = {},
    marketplaceOverrides: Partial<marketplace.TransferMultisigAuthorityAsyncInput> = {},
  ) => [
    await registry.getTransferMultisigAuthorityInstructionAsync({
      authority: f.roles.bootstrap,
      newAuthority: createNoopSigner(squads.vault),
      multisig: squads.multisig,
      programData: registryData,
      expectedAuthority: f.roles.bootstrap.address,
      vaultIndex: 0,
      expectedMembers: squads.memberAddresses,
      expectedTimeLock: options.timeLock ?? 0,
      ...overrides,
    }),
    await marketplace.getTransferMultisigAuthorityInstructionAsync({
      authority: f.roles.bootstrap,
      newAuthority: createNoopSigner(squads.vault),
      multisig: squads.multisig,
      programData: f.programDataAddress,
      expectedAuthority: f.roles.bootstrap.address,
      vaultIndex: 0,
      expectedMembers: squads.memberAddresses,
      expectedTimeLock: options.timeLock ?? 0,
      ...marketplaceOverrides,
    }),
  ];
  const upgrade = () => [
    transferUpgradeAuthority(registryData, f.roles.bootstrap, squads.vault),
    transferUpgradeAuthority(f.programDataAddress, f.roles.seller, squads.vault),
  ];
  const bytes = (key: typeof f.config) => {
    const account = f.client.svm.getAccount(key);
    if (!account.exists) throw new Error("Missing account");
    return Uint8Array.from(account.data);
  };
  return { ...f, squads, instructions, upgrade, bytes, registryData };
}

it("requires two real Squads approvals and atomically hands over both roots with the loader authorities", async () => {
  const f = await setup();
  const oldRegistry = f.bytes(f.registryConfig),
    oldMarket = f.bytes(f.config);
  const p = await f.squads.propose(await f.instructions(), [f.roles.bootstrap]);
  await p.approve();
  await expect(p.execute(f.upgrade())).rejects.toThrow();
  expect(f.bytes(f.registryConfig)).toEqual(oldRegistry);
  expect(f.bytes(f.config)).toEqual(oldMarket);
  await p.approve(f.squads.members[1]!);
  await p.execute(f.upgrade());
  const reg = registry.getKathaConfigDecoder().decode(f.bytes(f.registryConfig));
  const market = marketplace.getMarketplaceConfigDecoder().decode(f.bytes(f.config));
  expect(reg.authority).toBe(f.squads.vault);
  expect(market.authority).toBe(f.squads.vault);
  // Only the existing root field changes; roles, account layouts and economics stay intact.
  const expectedRegistry = Uint8Array.from(oldRegistry),
    expectedMarket = Uint8Array.from(oldMarket);
  expectedRegistry.set(getAddressEncoder().encode(f.squads.vault), 8);
  expectedMarket.set(getAddressEncoder().encode(f.squads.vault), 9);
  expect(f.bytes(f.registryConfig)).toEqual(expectedRegistry);
  expect(f.bytes(f.config)).toEqual(expectedMarket);
  const fees = await marketplace.getUpdateFeeScheduleInstructionAsync({
    authority: f.roles.bootstrap,
    expectedRevision: 1n,
    primaryCommissionBps: 800,
    secondaryCommissionBps: 200,
    secondaryRoyaltyBps: 500,
  });
  await expect(f.client.sendTransaction([fees])).rejects.toThrow();
  const governedFees = await marketplace.getUpdateFeeScheduleInstructionAsync({
    authority: createNoopSigner(f.squads.vault),
    expectedRevision: 1n,
    primaryCommissionBps: 800,
    secondaryCommissionBps: 200,
    secondaryRoyaltyBps: 500,
  });
  const update = await f.squads.propose([governedFees]);
  await update.approve();
  await expect(update.execute()).rejects.toThrow();
  await update.approve(f.squads.members[2]!);
  await update.execute();
  expect(
    marketplace.getFeeScheduleDecoder().decode(f.bytes(f.feeSchedule)),
  ).toMatchObject({
    revision: 2n,
    primaryCommissionBps: 800,
    secondaryCommissionBps: 200,
    secondaryRoyaltyBps: 500,
  });
  await expect(p.execute()).rejects.toThrow();
}, 30_000);

for (const [label, options] of [
  ["one-of-three threshold", { threshold: 1 }],
  ["controlled multisig", { controlled: true }],
] as const) {
  it(`rejects ${label} even when Squads itself permits execution`, async () => {
    const f = await setup(options);
    const before = f.bytes(f.registryConfig);
    const p = await f.squads.propose(await f.instructions(), [f.roles.bootstrap]);
    await p.approve();
    if (options.threshold !== 1) await p.approve(f.squads.members[1]!);
    await expect(p.execute(f.upgrade())).rejects.toThrow();
    expect(f.bytes(f.registryConfig)).toEqual(before);
  }, 30_000);
}

it("rejects wrong authority, membership, vault, delay, program data and unsigned vault without changing state", async () => {
  const f = await setup();
  const before = f.bytes(f.registryConfig);
  const instructions = await f.instructions();
  const missingVaultSignature: Instruction = {
    ...instructions[0]!,
    accounts: instructions[0]!.accounts!.map((account, i) =>
      i === 2 ? { address: account.address, role: AccountRole.READONLY } : account,
    ),
  };
  await expect(f.client.sendTransaction([missingVaultSignature])).rejects.toThrow();
  for (const override of [
    { expectedAuthority: f.roles.outsider.address },
    { expectedMembers: [...f.squads.memberAddresses].reverse() },
    { vaultIndex: 1 },
    { expectedTimeLock: 1 },
    { authority: f.roles.outsider },
    { programData: f.programDataAddress },
    { newAuthority: f.roles.outsider },
    { multisig: f.roles.outsider.address },
  ]) {
    const p = await f.squads.propose(await f.instructions(override), [
      f.roles.bootstrap,
      f.roles.outsider,
    ]);
    await p.approve();
    await p.approve(f.squads.members[1]!);
    await expect(p.execute(f.upgrade())).rejects.toThrow();
    expect(f.bytes(f.registryConfig)).toEqual(before);
  }
}, 30_000);

it("rejects a missing or forged Squads account, and requires upgrade protection before root handover", async () => {
  const f = await setup();
  const before = f.bytes(f.registryConfig);
  const p = await f.squads.propose(await f.instructions(), [f.roles.bootstrap]);
  await p.approve();
  await p.approve(f.squads.members[1]!);
  await expect(p.execute()).rejects.toThrow();
  expect(f.bytes(f.registryConfig)).toEqual(before);
  const original = f.client.svm.getAccount(f.squads.multisig);
  if (!original.exists) throw new Error("Missing Squads multisig");
  for (const data of [
    new Uint8Array(0),
    new Uint8Array(4),
    Uint8Array.from(original.data, (_, i) => (i < 8 ? 0 : original.data[i]!)),
  ]) {
    // Malformed external state is adversarial fixture data, never an acceptance signature.
    f.client.svm.setAccount({
      ...original,
      programAddress: SQUADS,
      data,
      space: BigInt(data.length),
      lamports: lamports(10_000_000n),
    });
    await expect(p.execute(f.upgrade())).rejects.toThrow();
    expect(f.bytes(f.registryConfig)).toEqual(before);
  }
}, 30_000);

it("rolls back both config and loader handovers when the second program rejects", async () => {
  const f = await setup();
  const keys = [f.registryConfig, f.config, f.registryData, f.programDataAddress];
  const before = keys.map(f.bytes);
  const p = await f.squads.propose(await f.instructions({}, { expectedTimeLock: 1 }), [
    f.roles.bootstrap,
  ]);
  await p.approve();
  await p.approve(f.squads.members[1]!);
  await expect(p.execute(f.upgrade())).rejects.toThrow();
  expect(keys.map(f.bytes)).toEqual(before);
}, 30_000);

it("honors a nonzero reviewed Squads delay before accepting either program root", async () => {
  const f = await setup({ timeLock: 2 });
  const p = await f.squads.propose(await f.instructions(), [f.roles.bootstrap]);
  await p.approve();
  await p.approve(f.squads.members[1]!);
  await expect(p.execute(f.upgrade())).rejects.toThrow();
  const clock = f.client.svm.getClock();
  clock.unixTimestamp += 3n;
  f.client.svm.setClock(clock);
  await p.execute(f.upgrade());
  expect(
    registry.getKathaConfigDecoder().decode(f.bytes(f.registryConfig)).authority,
  ).toBe(f.squads.vault);
  expect(
    marketplace.getMarketplaceConfigDecoder().decode(f.bytes(f.config)).authority,
  ).toBe(f.squads.vault);
}, 30_000);

it("Marketplace independently rejects stale terms, wrong members, vault, program data and authority", async () => {
  const f = await setup();
  const before = f.bytes(f.config);
  for (const override of [
    { expectedAuthority: f.roles.outsider.address },
    { expectedMembers: [...f.squads.memberAddresses].reverse() },
    { vaultIndex: 1 },
    { expectedTimeLock: 1 },
    { authority: f.roles.outsider },
    { programData: f.registryData },
    { newAuthority: f.roles.outsider },
    { multisig: f.roles.outsider.address },
  ]) {
    const instructions = await f.instructions({}, override);
    const p = await f.squads.propose(
      [instructions[1]!],
      [f.roles.bootstrap, f.roles.outsider],
    );
    await p.approve();
    await p.approve(f.squads.members[1]!);
    await expect(p.execute(f.upgrade())).rejects.toThrow();
    expect(f.bytes(f.config)).toEqual(before);
  }
}, 30_000);
