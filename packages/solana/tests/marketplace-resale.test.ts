import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  addSignersToInstruction,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import { readListingDelegates } from "./fixtures/core-plugins.js";
import {
  buildCreateListingTransaction,
  buildPurchaseListingTransaction,
  buildCancelListingTransaction,
  type MarketplaceTransactionContext,
} from "../src/marketplace.js";
import * as market from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

const uuid = () => new Uint8Array(Buffer.from(randomUUID().replaceAll("-", ""), "hex"));

async function setup() {
  const f = await setupMarketplaceConfiguration();
  const account = (key: Address) => {
    const value = f.client.svm.getAccount(key);
    if (!value.exists) throw new Error(`Missing synthetic account ${key}`);
    return value;
  };
  const [listing] = await market.findListingPda({ asset: f.artwork.asset });
  const [conditionHead] = await registry.findHeadPda({ artwork: f.artwork.artwork });
  const [custodyHead] = await registry.findInitializeCustodyHeadPda({
    artwork: f.artwork.artwork,
  });
  const [verification] = await registry.findVerificationPda({
    artwork: f.artwork.artwork,
  });
  const [metadataHead] = await registry.findInitializeMetadataHeadPda({
    artwork: f.artwork.artwork,
  });
  const [saleTerms] = await market.findSaleTermsPda({ artwork: f.artwork.artwork });
  const initialCustody = registry
    .getCustodyHeadDecoder()
    .decode(account(custodyHead).data);
  const immutableKeys = [
    f.artwork.artwork,
    verification,
    metadataHead,
    f.artwork.metadataRevision,
    f.artwork.initialCondition,
    initialCustody.latestTransition,
    f.collection,
    f.secondArtwork.artwork,
    f.secondArtwork.asset,
  ];
  const immutable = immutableKeys.map(account);
  const assertHistory = () => expect(immutableKeys.map(account)).toEqual(immutable);
  let now = f.clock;
  const setTime = (time: bigint) => {
    now = time;
    const clock = f.client.svm.getClock();
    clock.unixTimestamp = time;
    f.client.svm.setClock(clock);
  };
  const send = (ix: Instruction, signer?: TransactionSigner) => {
    f.client.svm.expireBlockhash();
    return f.client.sendTransaction([
      signer ? addSignersToInstruction([signer], ix) : ix,
    ]);
  };
  const context = (actor: TransactionSigner): MarketplaceTransactionContext => ({
    cluster: "localnet",
    feePayerAddress: f.roles.bootstrap.address,
    authorityAddress: actor.address,
    supportedTransactionVersions: new Set([0]),
    chainTime: now,
    currentBlockHeight: 0n,
    lifetime: {
      blockhash: f.client.svm.latestBlockhash(),
      lastValidBlockHeight: 1_000_000n,
    },
  });
  const snapshots = () => ({
    marketplaceConfigAccount: account(f.config),
    feeScheduleAccount: account(f.feeSchedule),
    listingFeesAccount: f.client.svm.getAccount(f.listingFees),
    registryConfigAccount: account(f.registryConfig),
    artworkAccount: account(f.artwork.artwork),
    assetAccount: account(f.artwork.asset),
    collectionAccount: account(f.collection),
    listingAccount: f.client.svm.getAccount(listing),
    conditionHeadAccount: account(conditionHead),
    saleTermsAccount: account(saleTerms),
  });
  const ledger = () => market.getListingRecordDecoder().decode(account(listing).data);
  const condition = () =>
    registry.getConditionHeadDecoder().decode(account(conditionHead).data);
  const custody = () =>
    registry.getCustodyHeadDecoder().decode(account(custodyHead).data);
  const create = async (
    seller: TransactionSigner,
    revision: bigint,
    expiresAt = now + 3600n,
  ) => {
    const prepared = await buildCreateListingTransaction(context(seller), snapshots(), {
      kathaId: f.artwork.kathaId,
      expectedRevision: revision,
      price: f.settings.examplePrice.toString(),
      expiresAt,
    });
    return send(prepared.instruction, seller);
  };
  const events: market.ArtworkPurchasedEvent[] = [];
  const preparePurchase = (buyer: TransactionSigner, revision: bigint) =>
    buildPurchaseListingTransaction(context(buyer), snapshots(), {
      kathaId: f.artwork.kathaId,
      expectedRevision: revision,
      expectedPrice: f.settings.examplePrice.toString(),
      buyerAddress: buyer.address,
      paymentMintAddress: f.mint,
    });
  const purchase = async (buyer: TransactionSigner, revision: bigint) => {
    const prepared = await preparePurchase(buyer, revision);
    const result = await send(prepared.instruction, buyer);
    const metadata = result.context.transactionMetadata;
    if ("err" in metadata) throw new Error("Successful purchase expected");
    const decoded = metadata
      .logs()
      .filter((line) => line.startsWith("Program data: "))
      .map((line) => Uint8Array.from(Buffer.from(line.slice(14), "base64")))
      .filter((bytes) =>
        market.ARTWORK_PURCHASED_EVENT_DISCRIMINATOR.every(
          (byte, i) => bytes[i] === byte,
        ),
      )
      .map(market.parseArtworkPurchasedEvent);
    expect(decoded).toHaveLength(1);
    events.push(decoded[0]!);
    return result;
  };
  const cancel = async (seller: TransactionSigner) => {
    const prepared = await buildCancelListingTransaction(context(seller), snapshots(), {
      kathaId: f.artwork.kathaId,
      expectedRevision: ledger().revision,
    });
    return send(prepared.instruction, seller);
  };
  const transition = async (
    action: registry.CustodyAction,
    collector: Address | null = null,
  ) => {
    const revision = custody().revision;
    const result = await send(
      await registry.getTransitionCustodyInstructionAsync({
        artwork: f.artwork.artwork,
        custodyAuthority: f.roles.custody,
        expectedRevision: revision,
        nextRevision: revision + 1n,
        action,
        collector,
      }),
    );
    const transitionKey = custody().latestTransition;
    immutableKeys.push(transitionKey);
    immutable.push(account(transitionKey));
    return result;
  };
  const inspect = async (
    overrides: Partial<registry.RecordMintedConditionAsyncInput> = {},
  ) => {
    const version = condition().version;
    const reportId = uuid();
    const input = {
      artwork: f.artwork.artwork,
      asset: f.artwork.asset,
      verifierAuthority: f.roles.verifier,
      expectedVersion: version,
      nextVersion: version + 1,
      expectedOwner: f.roles.buyerA.address,
      expectedCustodyRevision: custody().revision,
      reportId,
      reportHash: new Uint8Array(32).fill(version + 1),
      grade: registry.ConditionGrade.Good,
      reason: registry.ConditionReason.PreResale,
      inspectorId: uuid(),
      inspectedAt: now,
      ...overrides,
    };
    const [report] = await registry.findReportPda({ reportId: input.reportId });
    return {
      report,
      instruction: await registry.getRecordMintedConditionInstructionAsync(input),
    };
  };
  const rawCreate = (seller = f.roles.buyerA) =>
    market.getCreateListingWithFeesInstructionAsync({
      expectedFeeRevision: 1n,
      expectedCommissionBps: 250,
      expectedSecondaryRoyaltyBps: 500,
      artwork: f.artwork.artwork,
      seller,
      collection: f.collection,
      conditionReport: condition().currentReport,
      price: f.settings.examplePrice,
      expiresAt: now + 3600n,
      expectedRevision: ledger().revision,
    });
  const balances = () =>
    Promise.all(
      [
        f.tokenAccounts.buyerA,
        f.tokenAccounts.buyerB,
        f.tokenAccounts.seller,
        f.tokenAccounts.artist,
        f.tokenAccounts.treasury,
      ].map(async (key) => (await fetchToken(f.client.rpc, key)).data.amount),
    );
  // Exclude the fee payer: failed instructions may still charge native network fees.
  const state = () =>
    [
      f.artwork.asset,
      listing,
      conditionHead,
      custodyHead,
      saleTerms,
      f.tokenAccounts.buyerA,
      f.tokenAccounts.buyerB,
      f.tokenAccounts.seller,
      f.tokenAccounts.artist,
      f.tokenAccounts.treasury,
    ].map(account);
  const rejects = async (ix: Instruction) => {
    const before = state();
    await expect(send(ix)).rejects.toThrow();
    expect(state()).toEqual(before);
    assertHistory();
  };
  await send(await f.initialize());
  await send(await f.initializeFees());
  await send(
    await market.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority: f.roles.bootstrap,
      artistPayout: f.roles.artist.address,
    }),
  );
  await create(f.roles.seller, 0n);
  await purchase(f.roles.buyerA, 1n);
  expect(ledger()).toMatchObject({
    status: market.ListingStatus.Purchased,
    revision: 2n,
    completedSales: 1n,
  });
  assertHistory();
  const assertResale = async (
    revision: bigint,
    report: Address,
    custodyRevision: bigint,
  ) => {
    expect(await balances()).toEqual([
      992_500_000n,
      900_000_000n,
      0n,
      95_000_000n,
      12_500_000n,
    ]);
    expect(readListingDelegates(account(f.artwork.asset))).toEqual({
      owner: f.roles.buyerB.address,
      freeze: { frozen: false, authority: "Owner", address: null },
      transfer: { authority: "Owner", address: null },
    });
    expect(ledger()).toMatchObject({
      status: market.ListingStatus.Purchased,
      saleKind: market.SaleKind.Secondary,
      revision,
      completedSales: 2n,
      seller: f.roles.buyerA.address,
      artistPayout: f.roles.artist.address,
      conditionReport: report,
      custodyRevision,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      seller: f.roles.seller.address,
      buyer: f.roles.buyerA.address,
      saleKind: market.SaleKind.Primary,
      revision: 2n,
      completedSales: 1n,
    });
    expect(events[1]).toMatchObject({
      seller: f.roles.buyerA.address,
      buyer: f.roles.buyerB.address,
      saleKind: market.SaleKind.Secondary,
      revision,
      completedSales: 2n,
      conditionReport: report,
      custodyRevision,
      price: 100_000_000n,
      sellerProceeds: 92_500_000n,
      artistProceeds: 5_000_000n,
      treasuryFee: 2_500_000n,
    });
    assertHistory();
  };
  return {
    ...f,
    account,
    send,
    setTime,
    create,
    purchase,
    preparePurchase,
    cancel,
    inspect,
    transition,
    rawCreate,
    ledger,
    custody,
    condition,
    conditionHead,
    custodyHead,
    listing,
    state,
    rejects,
    balances,
    events,
    assertHistory,
    assertResale,
  };
}

it("resells after a genuine primary purchase with continuous Katha custody and preserved history", async () => {
  const f = await setup();
  const held = f.account(f.custodyHead),
    inspected = f.account(f.conditionHead);
  // Continuous custody can reuse its initial report even beyond the collector age limit.
  f.setTime(f.clock + f.settings.inspectionValiditySeconds + 1n);
  await f.rejects(await f.rawCreate(f.roles.seller));
  await f.create(f.roles.buyerA, 2n);
  expect(readListingDelegates(f.account(f.artwork.asset)).owner).toBe(
    f.roles.buyerA.address,
  );
  expect(f.ledger()).toMatchObject({
    completedSales: 1n,
    saleKind: market.SaleKind.Secondary,
  });
  await f.purchase(f.roles.buyerB, 3n);
  await f.assertResale(4n, f.artwork.initialCondition, 1n);
  expect(f.account(f.custodyHead)).toEqual(held);
  expect(f.account(f.conditionHead)).toEqual(inspected);
}, 30_000);

it("requires collector approval, rechecks expiry, renews inspection and preserves both sales through delivery", async () => {
  const f = await setup();
  await f.transition(registry.CustodyAction.DispatchFromKatha);
  await f.rejects(await f.rawCreate()); // In-transit cannot be sold.
  await f.transition(registry.CustodyAction.ReceiveByCollector, f.roles.buyerA.address);
  await f.rejects(await f.rawCreate()); // Initial report has no collector resale approval.
  for (const overrides of [
    { verifierAuthority: f.roles.outsider },
    { expectedOwner: f.roles.seller.address },
    { expectedCustodyRevision: 1n },
  ]) {
    const attempt = await f.inspect(overrides);
    await f.rejects(attempt.instruction);
    expect(f.client.svm.getAccount(attempt.report).exists).toBe(false);
  }
  const wrongReason = await f.inspect({ reason: registry.ConditionReason.PreSale });
  await f.send(wrongReason.instruction);
  await f.rejects(await f.rawCreate()); // Primary approval is not secondary approval.
  const approved = await f.inspect();
  await f.send(approved.instruction);
  const approvedBytes = f.account(approved.report);
  expect(
    registry.getConditionAttestationDecoder().decode(approvedBytes.data),
  ).toMatchObject({
    reason: registry.ConditionReason.PreResale,
    ownerScope: { __option: "Some", value: f.roles.buyerA.address },
    custodyRevisionScope: { __option: "Some", value: 3n },
    version: 3,
  });
  await f.create(
    f.roles.buyerA,
    2n,
    f.clock + f.settings.inspectionValiditySeconds + 3600n,
  );
  f.setTime(f.clock + f.settings.inspectionValiditySeconds + 1n);
  const beforeExpiry = f.state();
  await expect(f.purchase(f.roles.buyerB, 3n)).rejects.toThrow();
  expect(f.state()).toEqual(beforeExpiry);
  expect(f.events).toHaveLength(1);
  await f.cancel(f.roles.buyerA); // Recovery does not require a current inspection.
  expect(f.ledger()).toMatchObject({ revision: 4n, completedSales: 1n });
  await f.rejects(await f.rawCreate()); // Expired approval also prevents relisting.
  const renewedAt = f.clock + f.settings.inspectionValiditySeconds + 1n;
  const renewed = await f.inspect();
  await f.send(renewed.instruction);
  const renewedBytes = f.account(renewed.report),
    held = f.account(f.custodyHead);
  await f.create(
    f.roles.buyerA,
    4n,
    renewedAt + f.settings.inspectionValiditySeconds + 3600n,
  );
  f.setTime(renewedAt + f.settings.inspectionValiditySeconds); // Exact validity bound is inclusive.
  await f.purchase(f.roles.buyerB, 5n);
  await f.assertResale(6n, renewed.report, 3n);
  expect(f.account(f.custodyHead)).toEqual(held); // Physical holder is still A.
  expect(f.custody()).toMatchObject({
    state: registry.CustodyState.CollectorHeld,
    subject: { __option: "Some", value: f.roles.buyerA.address },
  });
  await f.rejects(await f.rawCreate(f.roles.buyerB)); // Core owner and physical holder differ.
  await f.transition(registry.CustodyAction.DispatchFromCollector);
  await f.transition(registry.CustodyAction.ReceiveByCollector, f.roles.buyerB.address);
  await f.rejects(await f.rawCreate(f.roles.buyerB)); // Old owner/custody approval cannot be reused.
  const nextOwner = await f.inspect({ expectedOwner: f.roles.buyerB.address });
  await f.send(nextOwner.instruction);
  await f.create(f.roles.buyerB, 6n);
  expect(f.ledger()).toMatchObject({
    completedSales: 2n,
    revision: 7n,
    saleKind: market.SaleKind.Secondary,
  });
  await f.cancel(f.roles.buyerB);
  expect(f.ledger()).toMatchObject({ completedSales: 2n, revision: 8n });
  expect(f.account(approved.report)).toEqual(approvedBytes);
  expect(f.account(renewed.report)).toEqual(renewedBytes);
  expect(f.client.svm.getAccount(wrongReason.report).exists).toBe(true);
  f.assertHistory();
}, 30_000);

it.each(["condition", "custody"] as const)(
  "rejects a resale purchase after %s changes while its offer is active",
  async (change) => {
    const f = await setup();
    await f.transition(registry.CustodyAction.DispatchFromKatha);
    await f.transition(
      registry.CustodyAction.ReceiveByCollector,
      f.roles.buyerA.address,
    );
    const approved = await f.inspect();
    await f.send(approved.instruction);
    await f.create(f.roles.buyerA, 2n);
    const quoted = await f.preparePurchase(f.roles.buyerB, 3n);
    const reportBytes = f.account(approved.report);
    if (change === "condition") {
      const revision = await f.inspect();
      await f.send(revision.instruction);
    } else {
      await f.transition(registry.CustodyAction.DispatchFromCollector);
    }
    await f.rejects(addSignersToInstruction([f.roles.buyerB], quoted.instruction));
    const before = f.state();
    await expect(f.purchase(f.roles.buyerB, 3n)).rejects.toThrow();
    expect(f.state()).toEqual(before);
    expect(f.events).toHaveLength(1);
    expect(readListingDelegates(f.account(f.artwork.asset))).toMatchObject({
      owner: f.roles.buyerA.address,
      freeze: { frozen: true, authority: "Address", address: f.listing },
    });
    await f.cancel(f.roles.buyerA);
    if (change === "custody") {
      await f.transition(registry.CustodyAction.ReceiveAtKatha);
      await f.rejects(await f.rawCreate()); // Returned custody requires its new revision's inspection.
      const returned = await f.inspect({
        reason: registry.ConditionReason.ReturnToCustody,
      });
      await f.send(returned.instruction);
    }
    const currentReport = f.condition().currentReport,
      custodyRevision = f.custody().revision;
    await f.create(f.roles.buyerA, 4n);
    const currentCustody = f.account(f.custodyHead);
    await f.purchase(f.roles.buyerB, 5n);
    await f.assertResale(6n, currentReport, custodyRevision);
    expect(f.account(f.custodyHead)).toEqual(currentCustody);
    expect(f.account(approved.report)).toEqual(reportBytes);
  },
  30_000,
);
