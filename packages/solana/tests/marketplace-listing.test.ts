import { expect, it } from "vitest";
import { AccountRole, address, generateKeyPairSigner, lamports } from "@solana/kit";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import {
  addTransferPlugin,
  readListingDelegates,
  thawAsOwner,
  transferAsOwner,
} from "./fixtures/core-plugins.js";
import * as marketplace from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

async function setup() {
  const f = await setupMarketplaceConfiguration();
  await f.client.sendTransaction([await f.initialize()]);
  await f.client.sendTransaction([await f.initializeFees()]);
  await f.client.sendTransaction([
    await marketplace.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority: f.roles.bootstrap,
      artistPayout: f.roles.artist.address,
    }),
  ]);
  const [listing, bump] = await marketplace.findListingPda({
    asset: f.artwork.asset,
  });
  const create = (
    overrides: Partial<marketplace.CreateListingWithFeesAsyncInput> = {},
  ) =>
    marketplace.getCreateListingWithFeesInstructionAsync({
      expectedFeeRevision: 1n,
      expectedCommissionBps: 1000,
      expectedSecondaryRoyaltyBps: 0,
      artwork: f.artwork.artwork,
      seller: f.roles.seller,
      conditionReport: f.artwork.initialCondition,
      collection: f.collection,
      price: f.settings.examplePrice,
      expiresAt: f.clock + 3600n,
      expectedRevision: 0n,
      ...overrides,
    });
  const send = async (
    overrides: Partial<marketplace.CreateListingWithFeesAsyncInput> = {},
  ) => {
    f.client.svm.expireBlockhash();
    return f.client.sendTransaction([await create(overrides)]);
  };
  return { ...f, listing, bump, create, send };
}

it("creates one active fixed-price listing with both PDA delegates while preserving owner, authorship and physical custody", async () => {
  const f = await setup();
  const [custody] = await marketplace.findCustodyHeadPda({
    artwork: f.artwork.artwork,
  });
  const beforeCustody = f.client.svm.getAccount(custody),
    beforeArtwork = f.client.svm.getAccount(f.artwork.artwork);
  // The same ordinary Core transfer is valid before freezing, on the second asset.
  await f.client.sendTransaction([
    transferAsOwner(
      f.secondArtwork.asset,
      f.collection,
      f.roles.seller,
      f.roles.buyerA.address,
    ),
  ]);
  const transferred = f.client.svm.getAccount(f.secondArtwork.asset);
  if (!transferred.exists) throw new Error("Missing transferred fixture");
  expect(readListingDelegates(transferred).owner).toBe(f.roles.buyerA.address);
  await f.send();
  const account = f.client.svm.getAccount(f.listing),
    asset = f.client.svm.getAccount(f.artwork.asset);
  if (!account.exists || !asset.exists) throw new Error("Missing listing or asset");
  expect(account.programAddress).toBe(marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS);
  expect(account.data.length).toBe(320);
  expect(marketplace.getListingRecordDecoder().decode(account.data)).toMatchObject({
    version: 2,
    config: f.config,
    artwork: f.artwork.artwork,
    asset: f.artwork.asset,
    seller: f.roles.seller.address,
    artistPayout: f.roles.artist.address,
    paymentMint: f.mint,
    price: f.settings.examplePrice,
    conditionReport: f.artwork.initialCondition,
    conditionHash: f.artwork.reportHash,
    conditionVersion: 1,
    custodyRevision: 1n,
    createdAt: f.clock,
    expiresAt: f.clock + 3600n,
    revision: 1n,
    completedSales: 0n,
    saleKind: marketplace.SaleKind.Primary,
    status: marketplace.ListingStatus.Active,
    bump: f.bump,
  });
  expect(readListingDelegates(asset)).toEqual({
    owner: f.roles.seller.address,
    freeze: { frozen: true, authority: "Address", address: f.listing },
    transfer: { authority: "Address", address: f.listing },
  });
  expect(f.client.svm.getAccount(custody)).toEqual(beforeCustody);
  expect(f.client.svm.getAccount(f.artwork.artwork)).toEqual(beforeArtwork);
  await expect(f.send({ expectedRevision: 1n })).rejects.toThrow();
  expect(f.client.svm.getAccount(f.listing)).toEqual(account);
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([
      transferAsOwner(
        f.artwork.asset,
        f.collection,
        f.roles.seller,
        f.roles.buyerA.address,
      ),
    ]),
  ).rejects.toThrow();
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([
      thawAsOwner(f.artwork.asset, f.collection, f.roles.seller),
    ]),
  ).rejects.toThrow();
  expect(f.client.svm.getAccount(f.artwork.asset)).toEqual(asset);
  const clock = f.client.svm.getClock();
  clock.unixTimestamp = f.clock + 3601n;
  f.client.svm.setClock(clock);
  await expect(
    f.send({ expectedRevision: 1n, expiresAt: clock.unixTimestamp + 3600n }),
  ).rejects.toThrow();
  expect(f.client.svm.getAccount(f.listing)).toEqual(account);
}, 30_000);

it("rejects wrong signers/accounts, stale revisions and invalid terms without creating ledger or delegates", async () => {
  const f = await setup();
  const before = f.client.svm.getAccount(f.artwork.asset);
  for (const override of [
    { seller: f.roles.outsider },
    { asset: f.secondArtwork.asset },
    { conditionReport: f.secondArtwork.initialCondition },
    { collection: f.artwork.asset },
    { coreProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS },
    { expectedRevision: 1n },
    { price: 0n },
    { expiresAt: f.clock },
    { expiresAt: -1n },
  ]) {
    await expect(f.send(override)).rejects.toThrow();
    expect(f.client.svm.getAccount(f.listing).exists).toBe(false);
    expect(f.client.svm.getAccount(f.artwork.asset)).toEqual(before);
  }
  const unsigned = await f.create();
  await expect(
    f.client.sendTransaction([
      {
        ...unsigned,
        accounts: unsigned.accounts.map((a) =>
          a.address === f.roles.seller.address
            ? { address: a.address, role: AccountRole.WRITABLE }
            : a,
        ),
      },
    ]),
  ).rejects.toThrow();
  // The entire transaction rolls back even after successful creation and both Core CPIs.
  const failedTransfer = f.client.token.instructions.transfer({
    source: f.tokenAccounts.seller,
    destination: f.tokenAccounts.buyerA,
    authority: f.roles.seller,
    amount: 1n,
  });
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([await f.create(), failedTransfer]),
  ).rejects.toThrow();
  expect(f.client.svm.getAccount(f.listing).exists).toBe(false);
  expect(f.client.svm.getAccount(f.artwork.asset)).toEqual(before);
  // A prefunded canonical PDA cannot deny the legitimate seller creation.
  f.client.svm.setAccount({
    address: f.listing,
    programAddress: address("11111111111111111111111111111111"),
    data: new Uint8Array(),
    space: 0n,
    executable: false,
    lamports: lamports(1n),
  });
  await f.send();
  expect(f.client.svm.getAccount(f.listing).exists).toBe(true);
}, 30_000);

it("rejects pre-existing owner plugins, invalid verification and transit custody before any partial lock", async () => {
  const f = await setup();
  await f.client.sendTransaction([
    addTransferPlugin(f.artwork.asset, f.collection, f.roles.seller),
  ]);
  const original = f.client.svm.getAccount(f.artwork.asset);
  await expect(f.send()).rejects.toThrow();
  expect(f.client.svm.getAccount(f.artwork.asset)).toEqual(original);
  expect(f.client.svm.getAccount(f.listing).exists).toBe(false);
  // Independent asset retains a plain fixture for genuine invalid-custody tests.
  const g = await setup();
  await g.client.sendTransaction([
    await registry.getTransitionCustodyInstructionAsync({
      artwork: g.artwork.artwork,
      custodyAuthority: g.roles.custody,
      expectedRevision: 1,
      nextRevision: 2,
      action: registry.CustodyAction.DispatchFromKatha,
      collector: null,
    }),
  ]);
  await expect(g.send()).rejects.toThrow();
  expect(g.client.svm.getAccount(g.listing).exists).toBe(false);
  const [verification] = await registry.findVerificationPda({
    artwork: g.artwork.artwork,
  });
  const state = g.client.svm.getAccount(verification);
  if (!state.exists) throw new Error("Missing verification");
  const forged = await generateKeyPairSigner();
  g.client.svm.setAccount({ ...state, address: forged.address });
  await expect(g.send({ verification: forged.address })).rejects.toThrow();
}, 30_000);

it("preserves completed-sale history and increments the expected revision when reopening an inactive ledger", async () => {
  const f = await setup();
  // Synthetic prior ledger until actual cancellation/purchase instructions exist.
  const value: marketplace.ListingRecordArgs = {
    version: 2,
    config: f.config,
    artwork: f.artwork.artwork,
    asset: f.artwork.asset,
    seller: f.roles.buyerA.address,
    artistPayout: f.roles.artist.address,
    paymentMint: f.mint,
    conditionReport: f.artwork.initialCondition,
    conditionHash: f.artwork.reportHash,
    conditionVersion: 1,
    custodyRevision: 1n,
    price: 10n,
    createdAt: f.clock - 100n,
    expiresAt: f.clock - 1n,
    revision: 4n,
    completedSales: 2n,
    saleKind: marketplace.SaleKind.Secondary,
    status: marketplace.ListingStatus.Cancelled,
    bump: f.bump,
  };
  const data = new Uint8Array(marketplace.getListingRecordEncoder().encode(value));
  f.client.svm.setAccount({
    address: f.listing,
    programAddress: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    data,
    space: BigInt(data.length),
    executable: false,
    lamports: lamports(10_000_000n),
  });
  const before = f.client.svm.getAccount(f.listing);
  await expect(f.send({ expectedRevision: 3n })).rejects.toThrow();
  expect(f.client.svm.getAccount(f.listing)).toEqual(before);
  await f.send({
    expectedRevision: 4n,
    expectedCommissionBps: 250,
    expectedSecondaryRoyaltyBps: 500,
  });
  const after = f.client.svm.getAccount(f.listing);
  if (!after.exists) throw new Error("Missing reopened ledger");
  expect(marketplace.getListingRecordDecoder().decode(after.data)).toMatchObject({
    revision: 5n,
    completedSales: 2n,
    saleKind: marketplace.SaleKind.Secondary,
    status: marketplace.ListingStatus.Active,
    seller: f.roles.seller.address,
    price: f.settings.examplePrice,
  });
}, 30_000);

it("requires a seller-reviewed fee revision and snapshots changed rates on the next listing", async () => {
  const f = await setup();
  await f.client.sendTransaction([
    await marketplace.getUpdateFeeScheduleInstructionAsync({
      authority: f.roles.bootstrap,
      expectedRevision: 1n,
      primaryCommissionBps: 1500,
      secondaryCommissionBps: 300,
      secondaryRoyaltyBps: 800,
    }),
  ]);
  await expect(f.send()).rejects.toThrow();
  expect(f.client.svm.getAccount(f.listing).exists).toBe(false);
  await f.send({ expectedFeeRevision: 2n, expectedCommissionBps: 1500 });
  const account = f.client.svm.getAccount(f.listingFees);
  if (!account.exists) throw new Error("Missing fee snapshot");
  expect(marketplace.getListingFeesDecoder().decode(account.data)).toMatchObject({
    listing: f.listing,
    listingRevision: 1n,
    scheduleRevision: 2n,
    commissionBps: 1500,
    secondaryRoyaltyBps: 0,
  });
}, 30_000);
