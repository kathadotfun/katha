import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { AccountRole, type Address } from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import {
  readListingDelegates,
  revokeTransferAsOwner,
} from "./fixtures/core-plugins.js";
import * as market from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

const uuid = () => new Uint8Array(Buffer.from(randomUUID().replaceAll("-", ""), "hex"));
async function setup(collectorHeld = false, artistIsTreasury = false) {
  const f = await setupMarketplaceConfiguration();
  await f.client.sendTransaction([await f.initialize()]);
  await f.client.sendTransaction([
    await market.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority: f.roles.bootstrap,
      artistPayout: artistIsTreasury
        ? f.roles.treasury.address
        : f.roles.artist.address,
    }),
  ]);
  let conditionReport = f.artwork.initialCondition;
  if (collectorHeld) {
    for (const [revision, action, collector] of [
      [1, registry.CustodyAction.DispatchFromKatha, null],
      [2, registry.CustodyAction.ReceiveByCollector, f.roles.seller.address],
    ] as const) {
      await f.client.sendTransaction([
        await registry.getTransitionCustodyInstructionAsync({
          artwork: f.artwork.artwork,
          custodyAuthority: f.roles.custody,
          expectedRevision: revision,
          nextRevision: revision + 1,
          action,
          collector,
        }),
      ]);
    }
    const reportId = uuid();
    await f.client.sendTransaction([
      await registry.getRecordMintedConditionInstructionAsync({
        artwork: f.artwork.artwork,
        asset: f.artwork.asset,
        verifierAuthority: f.roles.verifier,
        expectedVersion: 1,
        nextVersion: 2,
        expectedOwner: f.roles.seller.address,
        expectedCustodyRevision: 3,
        reportId,
        reportHash: new Uint8Array(32).fill(9),
        grade: registry.ConditionGrade.Good,
        reason: registry.ConditionReason.PreSale,
        inspectorId: uuid(),
        inspectedAt: f.clock,
      }),
    ]);
    [conditionReport] = await registry.findReportPda({ reportId });
  }
  const [listing] = await market.findListingPda({ asset: f.artwork.asset });
  await f.client.sendTransaction([
    await market.getCreateListingInstructionAsync({
      artwork: f.artwork.artwork,
      seller: f.roles.seller,
      conditionReport,
      collection: f.collection,
      price: f.settings.examplePrice,
      expiresAt:
        f.clock + (collectorHeld ? f.settings.inspectionValiditySeconds + 100n : 3600n),
      expectedRevision: 0n,
    }),
  ]);
  const purchase = (overrides: Partial<market.PurchaseListingAsyncInput> = {}) =>
    market.getPurchaseListingInstructionAsync({
      artwork: f.artwork.artwork,
      seller: f.roles.seller.address,
      conditionReport,
      collection: f.collection,
      buyer: f.roles.buyerA,
      paymentMint: f.mint,
      buyerTokens: f.tokenAccounts.buyerA,
      sellerTokens: f.tokenAccounts.seller,
      artistTokens: artistIsTreasury
        ? f.tokenAccounts.treasury
        : f.tokenAccounts.artist,
      treasuryTokens: f.tokenAccounts.treasury,
      expectedRevision: 1n,
      expectedPrice: f.settings.examplePrice,
      ...overrides,
    });
  const send = async (overrides: Partial<market.PurchaseListingAsyncInput> = {}) => {
    f.client.svm.expireBlockhash();
    return f.client.sendTransaction([await purchase(overrides)]);
  };
  const amount = async (account: Address) =>
    (await fetchToken(f.client.rpc, account)).data.amount;
  const state = () => {
    const asset = f.client.svm.getAccount(f.artwork.asset),
      ledger = f.client.svm.getAccount(listing);
    if (!asset.exists || !ledger.exists) throw new Error("Missing asset or ledger");
    return { asset, ledger };
  };
  const balances = async () =>
    Promise.all(
      [
        f.tokenAccounts.buyerA,
        f.tokenAccounts.seller,
        f.tokenAccounts.artist,
        f.tokenAccounts.treasury,
      ].map(amount),
    );
  return { ...f, listing, purchase, send, amount, state, balances };
}

it("atomically pays primary artist/treasury and transfers Core ownership without seller signature or custody/authorship changes", async () => {
  const f = await setup();
  const [custody] = await market.findCustodyHeadPda({ artwork: f.artwork.artwork });
  const originalCustody = f.client.svm.getAccount(custody),
    originalArtwork = f.client.svm.getAccount(f.artwork.artwork);
  await f.send();
  expect(await f.balances()).toEqual([900_000_000n, 0n, 97_500_000n, 2_500_000n]);
  expect(readListingDelegates(f.state().asset)).toEqual({
    owner: f.roles.buyerA.address,
    freeze: { frozen: false, authority: "Owner", address: null },
    transfer: { authority: "Owner", address: null },
  });
  expect(market.getListingRecordDecoder().decode(f.state().ledger.data)).toMatchObject({
    status: market.ListingStatus.Purchased,
    revision: 2n,
    completedSales: 1n,
    saleKind: market.SaleKind.Primary,
  });
  expect(f.client.svm.getAccount(custody)).toEqual(originalCustody);
  expect(f.client.svm.getAccount(f.artwork.artwork)).toEqual(originalArtwork);
  const bought = f.state(),
    balances = await f.balances();
  await expect(f.send()).rejects.toThrow();
  expect(f.state()).toEqual(bought);
  expect(await f.balances()).toEqual(balances);
}, 30_000);

it("settles a secondary sale with current owner approval and preserves primary history", async () => {
  const f = await setup();
  await f.send();
  f.client.svm.expireBlockhash();
  await f.client.sendTransaction([
    await market.getCreateListingInstructionAsync({
      artwork: f.artwork.artwork,
      seller: f.roles.buyerA,
      conditionReport: f.artwork.initialCondition,
      collection: f.collection,
      price: f.settings.examplePrice,
      expiresAt: f.clock + 3600n,
      expectedRevision: 2n,
    }),
  ]);
  await f.send({
    seller: f.roles.buyerA.address,
    buyer: f.roles.buyerB,
    buyerTokens: f.tokenAccounts.buyerB,
    sellerTokens: f.tokenAccounts.buyerA,
    expectedRevision: 3n,
  });
  expect(await f.amount(f.tokenAccounts.buyerB)).toBe(900_000_000n);
  expect(await f.balances()).toEqual([992_500_000n, 0n, 102_500_000n, 5_000_000n]);
  expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerB.address);
  expect(market.getListingRecordDecoder().decode(f.state().ledger.data)).toMatchObject({
    status: market.ListingStatus.Purchased,
    revision: 4n,
    completedSales: 2n,
    saleKind: market.SaleKind.Secondary,
  });
}, 30_000);

it("rejects wrong signers, price/revision, payout accounts, mint/program and forged artwork bindings before payment", async () => {
  const f = await setup();
  const before = f.state(),
    balances = await f.balances();
  for (const overrides of [
    { buyer: f.roles.outsider },
    { buyer: f.roles.seller, buyerTokens: f.tokenAccounts.seller },
    { seller: f.roles.outsider.address },
    { expectedRevision: 0n },
    { expectedPrice: 1n },
    { buyerTokens: f.tokenAccounts.buyerB },
    { buyerTokens: f.tokenAccounts.wrongMintBuyer },
    { artistTokens: f.tokenAccounts.treasury },
    { treasuryTokens: f.tokenAccounts.artist },
    { sellerTokens: f.tokenAccounts.buyerA },
    { artistTokens: f.tokenAccounts.buyerA },
    { paymentMint: f.wrongMint },
    { tokenProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS },
    { coreProgram: registry.KATHA_REGISTRY_PROGRAM_ADDRESS },
    { asset: f.secondArtwork.asset },
    { collection: f.artwork.asset },
    { conditionReport: f.secondArtwork.initialCondition },
  ]) {
    await expect(f.send(overrides)).rejects.toThrow();
    expect(f.state()).toEqual(before);
    expect(await f.balances()).toEqual(balances);
  }
  const signed = await f.purchase();
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([
      {
        ...signed,
        accounts: signed.accounts.map((a) =>
          a.address === f.roles.buyerA.address
            ? { address: a.address, role: AccountRole.WRITABLE }
            : a,
        ),
      },
    ]),
  ).rejects.toThrow();
  expect(f.state()).toEqual(before);
  expect(await f.balances()).toEqual(balances);
}, 30_000);

it("rejects expired offers, changed custody and revoked Core authority without partial payments", async () => {
  for (const invalidation of ["expiry", "custody", "delegate"] as const) {
    const f = await setup();
    if (invalidation === "expiry") {
      const clock = f.client.svm.getClock();
      clock.unixTimestamp = f.clock + 3600n;
      f.client.svm.setClock(clock);
    } else if (invalidation === "custody") {
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
    } else {
      await f.client.sendTransaction([
        revokeTransferAsOwner(f.artwork.asset, f.collection, f.roles.seller),
      ]);
    }
    const before = f.state(),
      balances = await f.balances();
    await expect(f.send()).rejects.toThrow();
    expect(f.state()).toEqual(before);
    expect(await f.balances()).toEqual(balances);
  }
}, 30_000);

it("rejects insufficient or frozen funds and rolls back a successful purchase when a later instruction fails", async () => {
  const f = await setup();
  const buyer = f.client.svm.getAccount(f.tokenAccounts.buyerA);
  if (!buyer.exists) throw new Error("Missing buyer token account");
  const before = f.state(),
    balances = await f.balances();
  // Explicit synthetic token-account mutations; balances stay outside actual networks.
  for (const mutation of ["empty", "frozen"] as const) {
    const data = new Uint8Array(buyer.data);
    if (mutation === "empty") data.fill(0, 64, 72);
    else data[108] = 2;
    f.client.svm.setAccount({ ...buyer, data });
    await expect(f.send()).rejects.toThrow();
    expect(f.state()).toEqual(before);
    expect(await f.amount(f.tokenAccounts.artist)).toBe(0n);
    expect(await f.amount(f.tokenAccounts.treasury)).toBe(0n);
  }
  f.client.svm.setAccount(buyer);
  f.client.svm.expireBlockhash();
  await expect(
    f.client.sendTransaction([
      await f.purchase(),
      f.client.token.instructions.transfer({
        source: f.tokenAccounts.seller,
        destination: f.tokenAccounts.buyerB,
        authority: f.roles.seller,
        amount: 1n,
      }),
    ]),
  ).rejects.toThrow();
  expect(f.state()).toEqual(before);
  expect(await f.balances()).toEqual(balances);
}, 30_000);

it("rechecks collector inspection expiry even while the listing remains unexpired", async () => {
  const f = await setup(true);
  const clock = f.client.svm.getClock();
  clock.unixTimestamp = f.clock + f.settings.inspectionValiditySeconds + 1n;
  f.client.svm.setClock(clock);
  const before = f.state(),
    balances = await f.balances();
  await expect(f.send()).rejects.toThrow();
  expect(f.state()).toEqual(before);
  expect(await f.balances()).toEqual(balances);
  clock.unixTimestamp -= 1n;
  f.client.svm.setClock(clock);
  await f.send();
  expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerA.address);
}, 30_000);

it("rejects a condition report changed after listing even if the replacement is valid", async () => {
  const f = await setup();
  const reportId = uuid();
  await f.client.sendTransaction([
    await registry.getRecordMintedConditionInstructionAsync({
      artwork: f.artwork.artwork,
      asset: f.artwork.asset,
      verifierAuthority: f.roles.verifier,
      expectedVersion: 1,
      nextVersion: 2,
      expectedOwner: f.roles.seller.address,
      expectedCustodyRevision: 1,
      reportId,
      reportHash: new Uint8Array(32).fill(8),
      grade: registry.ConditionGrade.Good,
      reason: registry.ConditionReason.PreSale,
      inspectorId: uuid(),
      inspectedAt: f.clock,
    }),
  ]);
  const [conditionReport] = await registry.findReportPda({ reportId });
  const before = f.state(),
    balances = await f.balances();
  await expect(f.send()).rejects.toThrow();
  await expect(f.send({ conditionReport })).rejects.toThrow();
  expect(f.state()).toEqual(before);
  expect(await f.balances()).toEqual(balances);
}, 30_000);

it("supports an intentionally shared artist and treasury payout account", async () => {
  const f = await setup(false, true);
  await f.send();
  expect(await f.balances()).toEqual([900_000_000n, 0n, 0n, 100_000_000n]);
  expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerA.address);
}, 30_000);
