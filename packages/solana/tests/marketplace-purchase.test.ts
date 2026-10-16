import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  AccountRole,
  address,
  addSignersToInstruction,
  type Address,
  type Instruction,
} from "@solana/kit";
import { fetchToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import {
  readListingDelegates,
  revokeTransferAsOwner,
  transferAsOwner,
} from "./fixtures/core-plugins.js";
import * as market from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";
import {
  buildCreateListingTransaction,
  buildCancelListingTransaction,
  buildExpireListingTransaction,
  buildPurchaseListingTransaction,
  type MarketplaceTransactionContext,
} from "../src/marketplace.js";

const uuid = () => new Uint8Array(Buffer.from(randomUUID().replaceAll("-", ""), "hex"));
async function setup(
  collectorHeld = false,
  artistIsTreasury = false,
  options: {
    price?: bigint;
    artistIsSeller?: boolean;
    commissionBps?: number;
    secondaryRoyaltyBps?: number;
  } = {},
) {
  const f = await setupMarketplaceConfiguration();
  const price = options.price ?? f.settings.examplePrice;
  await f.client.sendTransaction([
    await f.initialize({
      commissionBps: options.commissionBps ?? f.settings.commissionBps,
      secondaryRoyaltyBps:
        options.secondaryRoyaltyBps ?? f.settings.secondaryRoyaltyBps,
    }),
  ]);
  await f.client.sendTransaction([
    await f.initializeFees({
      primaryCommissionBps: options.commissionBps ?? 1000,
      secondaryCommissionBps: options.commissionBps ?? f.settings.commissionBps,
      secondaryRoyaltyBps:
        options.secondaryRoyaltyBps ?? f.settings.secondaryRoyaltyBps,
    }),
  ]);
  await f.client.sendTransaction([
    await market.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority: f.roles.bootstrap,
      artistPayout: artistIsTreasury
        ? f.roles.treasury.address
        : options.artistIsSeller
          ? f.roles.seller.address
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
    await market.getCreateListingWithFeesInstructionAsync({
      expectedFeeRevision: 1n,
      expectedCommissionBps: options.commissionBps ?? 1000,
      expectedSecondaryRoyaltyBps: 0,
      artwork: f.artwork.artwork,
      seller: f.roles.seller,
      conditionReport,
      collection: f.collection,
      price,
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
        : options.artistIsSeller
          ? f.tokenAccounts.seller
          : f.tokenAccounts.artist,
      treasuryTokens: f.tokenAccounts.treasury,
      expectedRevision: 1n,
      expectedPrice: price,
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
  expect(await f.balances()).toEqual([900_000_000n, 0n, 90_000_000n, 10_000_000n]);
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
    await market.getCreateListingWithFeesInstructionAsync({
      expectedFeeRevision: 1n,
      expectedCommissionBps: 250,
      expectedSecondaryRoyaltyBps: 500,
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
  expect(await f.balances()).toEqual([992_500_000n, 0n, 95_000_000n, 12_500_000n]);
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

it("serializes two quoted buyers so only the first purchase can settle", async () => {
  for (const first of ["buyerA", "buyerB"] as const) {
    const f = await setup();
    const second = first === "buyerA" ? "buyerB" : "buyerA";
    // Both buyers quote the same active revision before either transaction executes.
    const offers = await Promise.all(
      ([first, second] as const).map((buyer) =>
        f.purchase({
          buyer: f.roles[buyer],
          buyerTokens: f.tokenAccounts[buyer],
        }),
      ),
    );
    await f.client.sendTransaction([offers[0]!]);
    const settled = f.state();
    const balances = await Promise.all(Object.values(f.tokenAccounts).map(f.amount));
    f.client.svm.expireBlockhash();
    await expect(f.client.sendTransaction([offers[1]!])).rejects.toThrow();
    expect(f.state()).toEqual(settled);
    expect(await Promise.all(Object.values(f.tokenAccounts).map(f.amount))).toEqual(
      balances,
    );
    expect(readListingDelegates(settled.asset).owner).toBe(f.roles[first].address);
    expect(await f.amount(f.tokenAccounts[second])).toBe(f.settings.buyerBalance);
    expect(
      market.getListingRecordDecoder().decode(settled.ledger.data).completedSales,
    ).toBe(1n);
  }
}, 30_000);

it("serializes purchase/cancel in both orders and rejects stale quotes after relisting", async () => {
  for (const first of ["purchase", "cancel"] as const) {
    const f = await setup();
    const purchase = await f.purchase();
    const cancel = await market.getCancelListingInstructionAsync({
      artwork: f.artwork.artwork,
      actor: f.roles.seller,
      collection: f.collection,
      expectedRevision: 1n,
    });
    await f.client.sendTransaction([first === "purchase" ? purchase : cancel]);
    const terminal = f.state(),
      balances = await f.balances();
    f.client.svm.expireBlockhash();
    await expect(
      f.client.sendTransaction([first === "purchase" ? cancel : purchase]),
    ).rejects.toThrow();
    expect(f.state()).toEqual(terminal);
    expect(await f.balances()).toEqual(balances);
    const delegates = readListingDelegates(terminal.asset);
    expect(delegates.owner).toBe(
      first === "purchase" ? f.roles.buyerA.address : f.roles.seller.address,
    );
    expect(delegates.freeze?.frozen).toBe(false);
    if (first === "cancel") {
      await f.client.sendTransaction([
        await market.getCreateListingWithFeesInstructionAsync({
          expectedFeeRevision: 1n,
          expectedCommissionBps: 1000,
          expectedSecondaryRoyaltyBps: 0,
          artwork: f.artwork.artwork,
          seller: f.roles.seller,
          conditionReport: f.artwork.initialCondition,
          collection: f.collection,
          price: f.settings.examplePrice,
          expiresAt: f.clock + 3600n,
          expectedRevision: 2n,
        }),
      ]);
      const relisted = f.state();
      f.client.svm.expireBlockhash();
      await expect(f.client.sendTransaction([purchase])).rejects.toThrow();
      expect(f.state()).toEqual(relisted);
      expect(await f.balances()).toEqual(balances);
      expect(readListingDelegates(relisted.asset).freeze?.frozen).toBe(true);
      await f.send({ expectedRevision: 3n });
    }
  }
}, 30_000);

it("conserves tiny rounded payments and full u64 prices through real token CPIs", async () => {
  for (const price of [1n, 39n, 40n, 101n, (1n << 64n) - 1n]) {
    const f = await setup(false, false, { price });
    if (price > f.settings.buyerBalance) {
      // Synthetic boundary balances, not token issuance or real network funds.
      setTokenAmount(f, f.tokenAccounts.buyerA, price);
      setTokenAmount(f, f.tokenAccounts.buyerB, 0n);
      const mint = f.client.svm.getAccount(f.mint);
      if (!mint.exists) throw new Error("Missing mint");
      const data = Uint8Array.from(mint.data);
      new DataView(data.buffer).setBigUint64(36, price, true);
      f.client.svm.setAccount({ ...mint, data });
    }
    const source = await f.amount(f.tokenAccounts.buyerA);
    await f.send();
    const commission = (price * 1000n) / 10_000n;
    expect(await f.balances()).toEqual([
      source - price,
      0n,
      price - commission,
      commission,
    ]);
    expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerA.address);
  }
  const f = await setup(false, false, { price: 101n });
  await f.send();
  await f.client.sendTransaction([
    await market.getCreateListingWithFeesInstructionAsync({
      expectedFeeRevision: 1n,
      expectedCommissionBps: 250,
      expectedSecondaryRoyaltyBps: 500,
      artwork: f.artwork.artwork,
      seller: f.roles.buyerA,
      conditionReport: f.artwork.initialCondition,
      collection: f.collection,
      price: 101n,
      expiresAt: f.clock + 3600n,
      expectedRevision: 2n,
    }),
  ]);
  await f.send({
    seller: f.roles.buyerA.address,
    sellerTokens: f.tokenAccounts.buyerA,
    buyer: f.roles.buyerB,
    buyerTokens: f.tokenAccounts.buyerB,
    expectedRevision: 3n,
  });
  // Floor fees independently: 2 commission + 5 royalty, seller keeps 94.
  expect(await f.balances()).toEqual([999_999_993n, 0n, 96n, 12n]);
  expect(await f.amount(f.tokenAccounts.buyerB)).toBe(999_999_899n);
}, 30_000);

function setTokenAmount(
  f: Awaited<ReturnType<typeof setup>>,
  account: Address,
  amount: bigint,
) {
  const original = f.client.svm.getAccount(account);
  if (!original.exists) throw new Error("Missing synthetic token account");
  const data = Uint8Array.from(original.data);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  f.client.svm.setAccount({ ...original, data });
}

it("merges every secondary seller/artist/treasury overlap without losing role proceeds", async () => {
  for (const overlap of [
    "seller-artist",
    "seller-treasury",
    "artist-treasury",
    "all",
  ] as const) {
    const artistIsTreasury = overlap === "artist-treasury" || overlap === "all";
    const f = await setup(false, artistIsTreasury, {
      artistIsSeller: overlap === "seller-artist",
    });
    await f.send();
    const seller =
      overlap === "seller-artist"
        ? f.roles.seller
        : overlap === "artist-treasury"
          ? f.roles.buyerA
          : f.roles.treasury;
    const sellerTokens =
      overlap === "seller-artist"
        ? f.tokenAccounts.seller
        : overlap === "artist-treasury"
          ? f.tokenAccounts.buyerA
          : f.tokenAccounts.treasury;
    if (seller !== f.roles.buyerA) {
      await f.client.sendTransaction([
        transferAsOwner(f.artwork.asset, f.collection, f.roles.buyerA, seller.address),
      ]);
    }
    await f.client.sendTransaction([
      await market.getCreateListingWithFeesInstructionAsync({
        expectedFeeRevision: 1n,
        expectedCommissionBps: 250,
        expectedSecondaryRoyaltyBps: 500,
        artwork: f.artwork.artwork,
        seller,
        conditionReport: f.artwork.initialCondition,
        collection: f.collection,
        price: f.settings.examplePrice,
        expiresAt: f.clock + 3600n,
        expectedRevision: 2n,
      }),
    ]);
    const before = await f.balances();
    const expected = [...before];
    const artistIndex = artistIsTreasury ? 3 : overlap === "seller-artist" ? 1 : 2;
    const sellerIndex =
      sellerTokens === f.tokenAccounts.buyerA
        ? 0
        : sellerTokens === f.tokenAccounts.seller
          ? 1
          : 3;
    expected[sellerIndex] = expected[sellerIndex]! + 92_500_000n;
    expected[artistIndex] = expected[artistIndex]! + 5_000_000n;
    expected[3] = expected[3]! + 2_500_000n;
    await f.send({
      seller: seller.address,
      sellerTokens,
      buyer: f.roles.buyerB,
      buyerTokens: f.tokenAccounts.buyerB,
      expectedRevision: 3n,
    });
    expect(await f.balances()).toEqual(expected);
    expect(await f.amount(f.tokenAccounts.buyerB)).toBe(900_000_000n);
    expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerB.address);
  }
}, 30_000);

it.each(["token", "core"] as const)(
  "rolls back settlement when compute exhaustion interrupts a later %s CPI",
  async (stage) => {
    const f = await setup();
    const before = f.state(),
      balances = await f.balances();
    const purchase = await f.purchase();
    const core = purchase.accounts[13]!.address;
    const program = stage === "token" ? TOKEN_PROGRAM_ADDRESS : core;
    // Simulation supplies a budget inside the last CPI at this stage. This avoids
    // compiler-sensitive constants and proves earlier calls ran before failure.
    const baseline = await f.client.signTransaction([purchase]);
    const metadata = baseline.context.transactionMetadata;
    if (!metadata || "err" in metadata)
      throw new Error("Baseline purchase must simulate successfully");
    const consumption = metadata
      .logs()
      .filter((line) => line.startsWith(`Program ${program} consumed `))
      .at(-1);
    const match = consumption?.match(/consumed (\d+) of (\d+) compute units/);
    if (!match) throw new Error("Missing CPI consumption log");
    const consumed = Number(match[1]),
      remaining = Number(match[2]);
    // One top-level purchase instruction has the runtime's 200,000-unit default.
    // The extra Compute Budget instruction itself consumes 150 units.
    const units = 200_000 + 150 - remaining + Math.floor(consumed / 2);
    const data = new Uint8Array(5);
    data[0] = 2; // Solana Compute Budget SetComputeUnitLimit.
    new DataView(data.buffer).setUint32(1, units, true);
    const limit: Instruction = {
      programAddress: address("ComputeBudget111111111111111111111111111111"),
      data,
    };
    const signed = await f.client.signTransaction([limit, purchase]);
    const result = f.client.svm.sendTransaction(signed.context.transaction);
    expect("err" in result).toBe(true);
    if (!("err" in result)) throw new Error("Expected CPI compute exhaustion");
    const logs = result.meta().logs();
    expect(logs.some((line) => line.startsWith(`Program ${program} failed`))).toBe(
      true,
    );
    expect(
      logs.filter((line) => line === `Program ${TOKEN_PROGRAM_ADDRESS} success`),
    ).toHaveLength(stage === "token" ? 1 : 2);
    expect(logs.filter((line) => line === `Program ${core} success`)).toHaveLength(
      stage === "token" ? 0 : 2,
    );
    expect(f.state()).toEqual(before);
    expect(await f.balances()).toEqual(balances);
    expect(readListingDelegates(f.state().asset).freeze?.frozen).toBe(true);
    // The failed transaction must not consume the listing or duplicate payouts.
    await f.send();
    expect(await f.balances()).toEqual([900_000_000n, 0n, 90_000_000n, 10_000_000n]);
    expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerA.address);
  },
  30_000,
);

it("rejects different token accounts for overlapping wallets even when both accounts are valid", async () => {
  const f = await setup(false, true);
  const treasury = f.client.svm.getAccount(f.tokenAccounts.treasury);
  if (!treasury.exists) throw new Error("Missing treasury token account");
  // Synthetic second initialized, zero-balance account with the same mint/owner.
  f.client.svm.setAccount({ ...treasury, address: f.roles.outsider.address });
  const before = f.state(),
    balances = await f.balances();
  await expect(f.send({ artistTokens: f.roles.outsider.address })).rejects.toThrow();
  expect(f.state()).toEqual(before);
  expect(await f.balances()).toEqual(balances);
  expect(await f.amount(f.roles.outsider.address)).toBe(0n);
  await f.send();
  expect(await f.amount(f.tokenAccounts.treasury)).toBe(f.settings.examplePrice);
}, 30_000);

it("settles zero and full commission boundaries while validating zero-proceeds destinations", async () => {
  for (const commissionBps of [0, 10_000]) {
    const f = await setup(false, false, { commissionBps, secondaryRoyaltyBps: 0 });
    const before = f.state(),
      balances = await f.balances();
    await expect(
      f.send({ artistTokens: f.tokenAccounts.wrongMintBuyer }),
    ).rejects.toThrow();
    await expect(
      f.send({ treasuryTokens: f.tokenAccounts.wrongMintBuyer }),
    ).rejects.toThrow();
    expect(f.state()).toEqual(before);
    expect(await f.balances()).toEqual(balances);
    await f.send();
    expect(await f.balances()).toEqual(
      commissionBps === 0
        ? [900_000_000n, 0n, 100_000_000n, 0n]
        : [900_000_000n, 0n, 0n, 100_000_000n],
    );
    expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerA.address);
  }
}, 30_000);

it("executes marketplace builder instructions with real seller/buyer signatures and expiry recovery", async () => {
  const f = await setup();
  const required = (account: Address) => {
    const result = f.client.svm.getAccount(account);
    if (!result.exists) throw new Error("Missing builder snapshot");
    return result;
  };
  const [conditionHead] = await registry.findHeadPda({ artwork: f.artwork.artwork });
  const [saleTerms] = await market.findSaleTermsPda({ artwork: f.artwork.artwork });
  const accounts = () => ({
    marketplaceConfigAccount: required(f.config),
    feeScheduleAccount: required(f.feeSchedule),
    listingFeesAccount: f.client.svm.getAccount(f.listingFees),
    registryConfigAccount: required(f.registryConfig),
    artworkAccount: required(f.artwork.artwork),
    assetAccount: required(f.artwork.asset),
    collectionAccount: required(f.collection),
    listingAccount: required(f.listing),
    conditionHeadAccount: required(conditionHead),
    saleTermsAccount: required(saleTerms),
  });
  const context: MarketplaceTransactionContext = {
    cluster: "localnet",
    feePayerAddress: f.roles.bootstrap.address,
    authorityAddress: f.roles.seller.address,
    supportedTransactionVersions: new Set([0]),
    lifetime: {
      blockhash: f.client.svm.latestBlockhash(),
      lastValidBlockHeight: 1_000_000n,
    },
    currentBlockHeight: 0n,
    chainTime: f.clock,
  };
  const input = { kathaId: f.artwork.kathaId, expectedRevision: 1n };
  const cancel = await buildCancelListingTransaction(context, accounts(), input);
  await f.client.sendTransaction([
    addSignersToInstruction([f.roles.seller], cancel.instruction),
  ]);
  const create = await buildCreateListingTransaction(context, accounts(), {
    ...input,
    expectedRevision: 2n,
    price: f.settings.examplePrice.toString(),
    expiresAt: f.clock + 3600n,
  });
  await f.client.sendTransaction([
    addSignersToInstruction([f.roles.seller], create.instruction),
  ]);
  const clock = f.client.svm.getClock();
  clock.unixTimestamp = f.clock + 3600n;
  f.client.svm.setClock(clock);
  const expire = await buildExpireListingTransaction(
    {
      ...context,
      authorityAddress: f.roles.outsider.address,
      chainTime: clock.unixTimestamp,
    },
    accounts(),
    { ...input, expectedRevision: 3n },
  );
  await f.client.sendTransaction([
    addSignersToInstruction([f.roles.outsider], expire.instruction),
  ]);
  const relist = await buildCreateListingTransaction(
    { ...context, chainTime: clock.unixTimestamp },
    accounts(),
    {
      ...input,
      expectedRevision: 4n,
      price: f.settings.examplePrice.toString(),
      expiresAt: clock.unixTimestamp + 3600n,
    },
  );
  await f.client.sendTransaction([
    addSignersToInstruction([f.roles.seller], relist.instruction),
  ]);
  const buy = await buildPurchaseListingTransaction(
    {
      ...context,
      authorityAddress: f.roles.buyerA.address,
      chainTime: clock.unixTimestamp,
    },
    accounts(),
    {
      ...input,
      expectedRevision: 5n,
      expectedPrice: f.settings.examplePrice.toString(),
      buyerAddress: f.roles.buyerA.address,
      paymentMintAddress: f.mint,
    },
  );
  expect(buy.addresses.buyerTokens).toBe(f.tokenAccounts.buyerA);
  await f.client.sendTransaction([
    addSignersToInstruction([f.roles.buyerA], buy.instruction),
  ]);
  expect(await f.balances()).toEqual([900_000_000n, 0n, 90_000_000n, 10_000_000n]);
  expect(readListingDelegates(f.state().asset).owner).toBe(f.roles.buyerA.address);
  expect(market.getListingRecordDecoder().decode(f.state().ledger.data)).toMatchObject({
    status: market.ListingStatus.Purchased,
    revision: 6n,
    completedSales: 1n,
  });
}, 30_000);

it("locks reviewed listing fees across schedule changes and rejects forged/missing fee snapshots", async () => {
  const f = await setup();
  const before = f.state();
  const config = f.client.svm.getAccount(f.config);
  f.client.svm.expireBlockhash();
  await f.client.sendTransaction([
    await market.getUpdateFeeScheduleInstructionAsync({
      authority: f.roles.bootstrap,
      expectedRevision: 1n,
      primaryCommissionBps: 2000,
      secondaryCommissionBps: 400,
      secondaryRoyaltyBps: 700,
    }),
  ]);
  expect(f.client.svm.getAccount(f.config)).toEqual(config);
  for (const listingFees of [f.config, f.roles.outsider.address, f.feeSchedule]) {
    await expect(f.send({ listingFees })).rejects.toThrow();
    expect(f.state()).toEqual(before);
  }
  await f.send();
  expect(await f.balances()).toEqual([900_000_000n, 0n, 90_000_000n, 10_000_000n]);
  f.client.svm.expireBlockhash();
  await f.client.sendTransaction([
    await market.getCreateListingWithFeesInstructionAsync({
      artwork: f.artwork.artwork,
      seller: f.roles.buyerA,
      conditionReport: f.artwork.initialCondition,
      collection: f.collection,
      price: f.settings.examplePrice,
      expiresAt: f.clock + 3600n,
      expectedRevision: 2n,
      expectedFeeRevision: 2n,
      expectedCommissionBps: 400,
      expectedSecondaryRoyaltyBps: 700,
    }),
  ]);
  await f.send({
    buyer: f.roles.buyerB,
    buyerTokens: f.tokenAccounts.buyerB,
    seller: f.roles.buyerA.address,
    sellerTokens: f.tokenAccounts.buyerA,
    expectedRevision: 3n,
  });
  expect(await f.balances()).toEqual([989_000_000n, 0n, 97_000_000n, 14_000_000n]);
}, 30_000);

it("keeps deployed version-1 listings purchasable at their original initialization fees", async () => {
  const f = await setup();
  const old = f.state().ledger;
  f.client.svm.setAccount({
    ...old,
    data: Uint8Array.from(
      market.getListingRecordEncoder().encode({
        ...market.getListingRecordDecoder().decode(old.data),
        version: 1,
      }),
    ),
  });
  await f.send();
  expect(await f.balances()).toEqual([900_000_000n, 0n, 97_500_000n, 2_500_000n]);
}, 30_000);
