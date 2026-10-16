import { expect, it } from "vitest";
import { AccountRole, type Instruction } from "@solana/kit";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import {
  readListingDelegates,
  revokeTransferAsOwner,
  thawAsOwner,
  transferAsOwner,
} from "./fixtures/core-plugins.js";
import * as market from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

async function setup() {
  const f = await setupMarketplaceConfiguration();
  await f.client.sendTransaction([await f.initialize()]);
  await f.client.sendTransaction([await f.initializeFees()]);
  await f.client.sendTransaction([
    await market.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority: f.roles.bootstrap,
      artistPayout: f.roles.artist.address,
    }),
  ]);
  const [listing] = await market.findListingPda({ asset: f.artwork.asset });
  const rates = () => {
    const ledger = f.client.svm.getAccount(listing);
    const secondary =
      ledger.exists &&
      market.getListingRecordDecoder().decode(ledger.data).completedSales > 0n;
    return {
      expectedCommissionBps: secondary ? 250 : 1000,
      expectedSecondaryRoyaltyBps: secondary ? 500 : 0,
    };
  };
  const create = (expectedRevision = 0n) =>
    market.getCreateListingWithFeesInstructionAsync({
      expectedFeeRevision: 1n,
      ...rates(),
      artwork: f.artwork.artwork,
      seller: f.roles.seller,
      conditionReport: f.artwork.initialCondition,
      collection: f.collection,
      price: f.settings.examplePrice,
      expiresAt: f.client.svm.getClock().unixTimestamp + 3600n,
      expectedRevision,
    });
  await f.client.sendTransaction([await create()]);
  const input = {
    artwork: f.artwork.artwork,
    actor: f.roles.seller,
    collection: f.collection,
    expectedRevision: 1n,
  };
  const cancel = (overrides: Partial<market.CancelListingAsyncInput> = {}) =>
    market.getCancelListingInstructionAsync({ ...input, ...overrides });
  const expire = (overrides: Partial<market.ExpireListingAsyncInput> = {}) =>
    market.getExpireListingInstructionAsync({
      ...input,
      actor: f.roles.outsider,
      ...overrides,
    });
  const record = () => {
    const account = f.client.svm.getAccount(listing);
    if (!account.exists) throw new Error("Missing listing");
    return market.getListingRecordDecoder().decode(account.data);
  };
  const asset = () => {
    const account = f.client.svm.getAccount(f.artwork.asset);
    if (!account.exists) throw new Error("Missing Core asset");
    return account;
  };
  const atExpiry = () => {
    const clock = f.client.svm.getClock();
    clock.unixTimestamp = f.clock + 3600n;
    f.client.svm.setClock(clock);
  };
  const send = async (instruction: Promise<Instruction>) => {
    f.client.svm.expireBlockhash();
    return f.client.sendTransaction([await instruction]);
  };
  return { ...f, listing, create, cancel, expire, record, asset, atExpiry, send };
}

it("seller cancellation resets delegates, preserves attribution/custody/history and permits transfer or relisting", async () => {
  const f = await setup();
  const before = f.record();
  const [custody] = await market.findCustodyHeadPda({ artwork: f.artwork.artwork });
  const originalCustody = f.client.svm.getAccount(custody),
    originalArtwork = f.client.svm.getAccount(f.artwork.artwork);
  await f.send(f.cancel());
  expect(f.record()).toEqual({
    ...before,
    status: market.ListingStatus.Cancelled,
    revision: 2n,
  });
  expect(readListingDelegates(f.asset())).toEqual({
    owner: f.roles.seller.address,
    freeze: { frozen: false, authority: "Owner", address: null },
    transfer: { authority: "Owner", address: null },
  });
  expect(f.client.svm.getAccount(custody)).toEqual(originalCustody);
  expect(f.client.svm.getAccount(f.artwork.artwork)).toEqual(originalArtwork);
  await expect(f.send(f.cancel({ expectedRevision: 2n }))).rejects.toThrow();
  await f.send(f.create(2n));
  expect(f.record()).toMatchObject({
    status: market.ListingStatus.Active,
    revision: 3n,
    completedSales: 0n,
  });
  await expect(f.send(f.cancel())).rejects.toThrow();
  expect(readListingDelegates(f.asset()).freeze?.frozen).toBe(true);
  await f.send(f.cancel({ expectedRevision: 3n }));
  f.client.svm.expireBlockhash();
  await f.client.sendTransaction([
    transferAsOwner(
      f.artwork.asset,
      f.collection,
      f.roles.seller,
      f.roles.buyerA.address,
    ),
  ]);
  expect(readListingDelegates(f.asset()).owner).toBe(f.roles.buyerA.address);
}, 30_000);

it("expiry is permissionless at the inclusive boundary and preserves owner-funded storage rent", async () => {
  const f = await setup();
  await expect(f.send(f.expire())).rejects.toThrow();
  f.atExpiry();
  const sellerBefore = f.client.svm.getAccount(f.roles.seller.address),
    callerBefore = f.client.svm.getAccount(f.roles.outsider.address),
    assetBefore = f.asset();
  await f.send(f.expire());
  const sellerAfter = f.client.svm.getAccount(f.roles.seller.address),
    callerAfter = f.client.svm.getAccount(f.roles.outsider.address);
  if (
    !sellerBefore.exists ||
    !sellerAfter.exists ||
    !callerBefore.exists ||
    !callerAfter.exists
  )
    throw new Error("Missing wallets");
  const recovered = assetBefore.lamports - f.asset().lamports;
  expect(recovered).toBe(0n);
  expect(sellerAfter.lamports - sellerBefore.lamports).toBe(recovered);
  expect(callerAfter.lamports).toBe(callerBefore.lamports);
  expect(f.record()).toMatchObject({
    status: market.ListingStatus.Expired,
    revision: 2n,
  });
  expect(readListingDelegates(f.asset()).freeze).toEqual({
    frozen: false,
    authority: "Owner",
    address: null,
  });
  await expect(f.send(f.expire({ expectedRevision: 2n }))).rejects.toThrow();
  await f.send(f.create(2n));
  await expect(f.send(f.expire())).rejects.toThrow();
  expect(readListingDelegates(f.asset()).freeze?.frozen).toBe(true);
}, 30_000);

it("rejects unauthorized, unsigned, stale and substituted accounts without releasing the lock", async () => {
  const f = await setup();
  const before = f.asset(),
    ledger = f.record();
  for (const override of [
    { actor: f.roles.outsider },
    { expectedRevision: 0n },
    { asset: f.secondArtwork.asset },
    { artwork: f.secondArtwork.artwork },
    { listing: f.artwork.artwork },
    { collection: f.artwork.asset },
    { coreProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS },
  ]) {
    await expect(f.send(f.cancel(override))).rejects.toThrow();
    expect(f.asset()).toEqual(before);
    expect(f.record()).toEqual(ledger);
  }
  const unsigned = await f.cancel();
  f.client.svm.expireBlockhash();
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
  expect(f.asset()).toEqual(before);
}, 30_000);

it("release rolls back after a later failure and does not require still-current sale eligibility", async () => {
  const f = await setup();
  const before = f.asset(),
    ledger = f.record();
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([
      await f.cancel(),
      f.client.token.instructions.transfer({
        source: f.tokenAccounts.seller,
        destination: f.tokenAccounts.buyerA,
        authority: f.roles.seller,
        amount: 1n,
      }),
    ]),
  ).rejects.toThrow();
  expect(f.asset()).toEqual(before);
  expect(f.record()).toEqual(ledger);
  await f.client.sendTransaction([
    await registry.getTransitionCustodyInstructionAsync({
      artwork: f.artwork.artwork,
      custodyAuthority: f.roles.custody,
      expectedRevision: 1,
      nextRevision: 2,
      action: registry.CustodyAction.DispatchFromKatha,
      collector: null,
    }),
  ]);
  await f.send(f.cancel());
  expect(f.record().status).toBe(market.ListingStatus.Cancelled);
}, 30_000);

it("can release after the owner revokes transfer delegation without removing the owner's permission", async () => {
  const f = await setup();
  await f.client.sendTransaction([
    revokeTransferAsOwner(f.artwork.asset, f.collection, f.roles.seller),
  ]);
  expect(readListingDelegates(f.asset()).transfer?.authority).toBe("Owner");
  await f.send(f.cancel());
  expect(readListingDelegates(f.asset())).toEqual({
    owner: f.roles.seller.address,
    freeze: { frozen: false, authority: "Owner", address: null },
    transfer: { authority: "Owner", address: null },
  });
  await f.send(f.create(2n));
  expect(readListingDelegates(f.asset()).freeze?.frozen).toBe(true);
}, 30_000);

it("rejects invalid ledger versions and revision overflow before CPI, preserving completed-sale history on release", async () => {
  const f = await setup();
  const original = f.client.svm.getAccount(f.listing),
    locked = f.asset();
  if (!original.exists) throw new Error("Missing listing");
  const record = f.record();
  // Synthetic ledger mutations exercise invariants; no prior purchase is claimed.
  for (const patch of [
    { version: 3 },
    { revision: (1n << 64n) - 1n },
    { asset: f.secondArtwork.asset },
    { config: f.artwork.artwork },
  ]) {
    f.client.svm.setAccount({
      ...original,
      data: new Uint8Array(
        market.getListingRecordEncoder().encode({ ...record, ...patch }),
      ),
    });
    await expect(
      f.send(f.cancel({ expectedRevision: patch.revision ?? 1n })),
    ).rejects.toThrow();
    expect(f.asset()).toEqual(locked);
  }
  f.client.svm.setAccount({
    ...original,
    data: new Uint8Array(
      market.getListingRecordEncoder().encode({ ...record, completedSales: 7n }),
    ),
  });
  f.atExpiry();
  // Seller cancellation remains valid after expiry and does not become a completed sale.
  await f.send(f.cancel());
  expect(f.record()).toMatchObject({
    status: market.ListingStatus.Cancelled,
    revision: 2n,
    completedSales: 7n,
  });
  await f.send(f.create(2n));
  expect(f.record()).toMatchObject({
    status: market.ListingStatus.Active,
    revision: 3n,
    completedSales: 7n,
    saleKind: market.SaleKind.Secondary,
  });
}, 30_000);

it("never thaws an owner-controlled freeze or an asset with a different current owner", async () => {
  const f = await setup();
  const original = f.record();
  await f.send(f.cancel());
  await f.client.sendTransaction([
    thawAsOwner(f.artwork.asset, f.collection, f.roles.seller, true),
  ]);
  const ledger = f.client.svm.getAccount(f.listing);
  if (!ledger.exists) throw new Error("Missing listing");
  // Corrupt active ledger fixture cannot authorize a freeze owned by someone else.
  f.client.svm.setAccount({
    ...ledger,
    data: new Uint8Array(
      market.getListingRecordEncoder().encode({ ...original, revision: 3n }),
    ),
  });
  const before = f.asset();
  await expect(f.send(f.cancel({ expectedRevision: 3n }))).rejects.toThrow();
  expect(f.asset()).toEqual(before);
  await f.client.sendTransaction([
    thawAsOwner(f.artwork.asset, f.collection, f.roles.seller),
  ]);
  await f.client.sendTransaction([
    transferAsOwner(
      f.artwork.asset,
      f.collection,
      f.roles.seller,
      f.roles.buyerA.address,
    ),
  ]);
  const transferred = f.asset();
  await expect(f.send(f.cancel({ expectedRevision: 3n }))).rejects.toThrow();
  expect(f.asset()).toEqual(transferred);
}, 30_000);
