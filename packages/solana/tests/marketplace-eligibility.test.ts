import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getAddressDecoder,
  lamports,
} from "@solana/kit";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import * as marketplace from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

const uuid = () => new Uint8Array(Buffer.from(randomUUID().replaceAll("-", ""), "hex"));
async function setup() {
  const f = await setupMarketplaceConfiguration();
  await f.client.sendTransaction([await f.initialize()]);
  const terms = (overrides: Partial<marketplace.InitializeSaleTermsAsyncInput> = {}) =>
    marketplace.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority: f.roles.bootstrap,
      artistPayout: f.roles.artist.address,
      ...overrides,
    });
  const [saleTerms] = await marketplace.findSaleTermsPda({
    artwork: f.artwork.artwork,
  });
  const [listing, listingBump] = await marketplace.findListingAddressPda({
    asset: f.artwork.asset,
  });
  const check = (overrides: Partial<marketplace.CheckSaleEligibilityAsyncInput> = {}) =>
    marketplace.getCheckSaleEligibilityInstructionAsync({
      artwork: f.artwork.artwork,
      conditionReport: f.artwork.initialCondition,
      seller: f.roles.seller,
      listingAddress: listing,
      listing: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      ...overrides,
    });
  const sendCheck = async (
    overrides: Partial<marketplace.CheckSaleEligibilityAsyncInput> = {},
  ) => {
    f.client.svm.expireBlockhash();
    return f.client.sendTransaction([await check(overrides)]);
  };
  const rejects = async (
    overrides: Partial<marketplace.CheckSaleEligibilityAsyncInput> = {},
  ) => {
    await expect(sendCheck(overrides)).rejects.toThrow();
  };
  // Step 107 defines the ledger but cannot create listings or settle sales yet.
  // Install only hypothetical historical ledger bytes to exercise classification.
  const installHistory = (overrides: Partial<marketplace.ListingRecordArgs> = {}) => {
    const value: marketplace.ListingRecordArgs = {
      version: 1,
      config: f.config,
      artwork: f.artwork.artwork,
      asset: f.artwork.asset,
      seller: f.roles.seller.address,
      artistPayout: f.roles.artist.address,
      paymentMint: f.mint,
      conditionReport: f.artwork.initialCondition,
      conditionHash: f.artwork.reportHash,
      conditionVersion: 1,
      custodyRevision: 1n,
      price: f.settings.examplePrice,
      createdAt: f.clock,
      expiresAt: f.clock + 3600n,
      revision: 1n,
      completedSales: 1n,
      saleKind: marketplace.SaleKind.Secondary,
      status: marketplace.ListingStatus.Purchased,
      bump: listingBump,
      ...overrides,
    };
    const data = new Uint8Array(marketplace.getListingRecordEncoder().encode(value));
    f.client.svm.setAccount({
      address: listing,
      programAddress: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      data,
      lamports: lamports(10_000_000n),
      executable: false,
      space: BigInt(data.length),
    });
  };
  return { ...f, terms, saleTerms, listing, check, sendCheck, rejects, installHistory };
}

it("binds artist payout separately from creator identity only with platform authorization and forbids replacement", async () => {
  const f = await setup();
  await f.rejects(); // No payout account exists.
  await expect(
    f.client.sendTransaction([await f.terms({ authority: f.roles.outsider })]),
  ).rejects.toThrow();
  await expect(
    f.client.sendTransaction([
      await f.terms({ artistPayout: address("11111111111111111111111111111111") }),
    ]),
  ).rejects.toThrow();
  expect(f.client.svm.getAccount(f.saleTerms).exists).toBe(false);
  // Platform may approve a payout wallet different from the attributed creator wallet.
  await f.client.sendTransaction([
    await f.terms({ artistPayout: f.roles.buyerB.address }),
  ]);
  const terms = f.client.svm.getAccount(f.saleTerms);
  if (!terms.exists) throw new Error("Missing payout terms");
  expect(terms.data.length).toBe(74);
  expect(marketplace.getArtworkSaleTermsDecoder().decode(terms.data)).toMatchObject({
    artwork: f.artwork.artwork,
    artistPayout: f.roles.buyerB.address,
    version: 1,
  });
  await f.sendCheck();
  f.client.svm.expireBlockhash();
  await expect(f.client.sendTransaction([await f.terms()])).rejects.toThrow();
  expect(f.client.svm.getAccount(f.saleTerms)).toEqual(terms);
  const artwork = f.client.svm.getAccount(f.artwork.artwork);
  if (!artwork.exists) throw new Error("Missing artwork");
  expect(
    registry.getArtworkRecordDecoder().decode(artwork.data).creatorWallet,
  ).toMatchObject({
    __option: "Some",
    value: f.roles.artist.address,
  });
}, 30_000);

it("validates real Core owner, verification, canonical accounts and current commitments without changing artwork state", async () => {
  const f = await setup();
  await f.client.sendTransaction([await f.terms()]);
  const before = f.client.svm.getAccount(f.artwork.asset);
  await f.sendCheck();
  expect(f.client.svm.getAccount(f.artwork.asset)).toEqual(before);
  expect(f.client.svm.getAccount(f.listing).exists).toBe(false);
  if (!before.exists) throw new Error("Missing Core asset");
  // Core AssetV1's fixed prefix is key, owner, collection-authority tag/address.
  expect(getAddressDecoder().decode(before.data.subarray(1, 33))).toBe(
    f.roles.seller.address,
  );
  expect(getAddressDecoder().decode(before.data.subarray(34, 66))).toBe(f.collection);
  for (const [start, replacement] of [
    [1, f.roles.outsider.address],
    [34, f.secondArtwork.asset],
  ] as const) {
    const data = Uint8Array.from(before.data);
    data.set(getAddressEncoder().encode(replacement), start);
    f.client.svm.setAccount({ ...before, data });
    await f.rejects();
  }
  const wrongName = Uint8Array.from(before.data);
  const nameOffset = Buffer.from(wrongName).indexOf(f.artwork.kathaId);
  expect(nameOffset).toBeGreaterThan(65);
  wrongName[nameOffset] = 88;
  f.client.svm.setAccount({ ...before, data: wrongName });
  await f.rejects();
  f.client.svm.setAccount({
    ...before,
    programAddress: address("11111111111111111111111111111111"),
  });
  await f.rejects();
  f.client.svm.setAccount(before);
  await f.rejects({ seller: f.roles.outsider });
  await f.rejects({ asset: f.secondArtwork.asset });
  await f.rejects({ conditionReport: f.secondArtwork.initialCondition });
  await f.rejects({ registryProgram: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS });
  await f.rejects({ registryConfig: f.config });
  const unsigned = await f.check();
  await expect(
    f.client.sendTransaction([
      {
        ...unsigned,
        accounts: unsigned.accounts.map((a) =>
          a.address === f.roles.seller.address
            ? { address: a.address, role: AccountRole.READONLY }
            : a,
        ),
      },
    ]),
  ).rejects.toThrow();
  const [verification] = await registry.findVerificationPda({
    artwork: f.artwork.artwork,
  });
  const original = f.client.svm.getAccount(verification);
  if (!original.exists) throw new Error("Missing verification");
  const forged = await generateKeyPairSigner();
  f.client.svm.setAccount({ ...original, address: forged.address });
  await f.rejects({ verification: forged.address });
  f.client.svm.setAccount({
    ...original,
    programAddress: address("11111111111111111111111111111111"),
  });
  await f.rejects();
  f.client.svm.setAccount(original);
  const value = registry.getArtworkVerificationDecoder().decode(original.data);
  for (const override of [
    { authorshipEvidenceHash: new Uint8Array(32) },
    { verifier: f.roles.outsider.address },
  ]) {
    f.client.svm.setAccount({
      ...original,
      data: new Uint8Array(
        registry.getArtworkVerificationEncoder().encode({ ...value, ...override }),
      ),
    });
    await f.rejects();
  }
  f.client.svm.setAccount(original);
  const report = f.client.svm.getAccount(f.artwork.initialCondition);
  if (!report.exists) throw new Error("Missing report");
  const reportValue = registry.getConditionAttestationDecoder().decode(report.data);
  for (const override of [
    { reportHash: new Uint8Array(32) },
    { version: 2 },
    { verifier: f.roles.outsider.address },
  ]) {
    f.client.svm.setAccount({
      ...report,
      data: new Uint8Array(
        registry
          .getConditionAttestationEncoder()
          .encode({ ...reportValue, ...override }),
      ),
    });
    await f.rejects();
  }
  f.client.svm.setAccount(report);
  await f.sendCheck();
  f.installHistory();
  await f.rejects(); // Existing history cannot be omitted to claim primary eligibility.
  await f.sendCheck({ listing: f.listing });
  for (const override of [
    { artistPayout: f.roles.outsider.address },
    { paymentMint: f.wrongMint },
    { version: 2 },
    { artwork: f.secondArtwork.artwork },
  ]) {
    f.installHistory(override);
    await f.rejects({ listing: f.listing });
  }
}, 30_000);

it("reuses continuous Katha inspection but requires fresh current-owner collector resale approval and invalidates physical custody changes", async () => {
  const f = await setup();
  await f.client.sendTransaction([await f.terms()]);
  f.installHistory();
  const secondary = { listing: f.listing };
  const clock = f.client.svm.getClock();
  clock.unixTimestamp = f.clock + f.settings.inspectionValiditySeconds + 100n;
  f.client.svm.setClock(clock);
  await f.sendCheck(secondary); // Unchanged Katha custody does not expire by owner turnover.
  async function custody(
    expectedRevision: number,
    action: registry.CustodyAction,
    collector: typeof f.roles.seller.address | null,
  ) {
    await f.client.sendTransaction([
      await registry.getTransitionCustodyInstructionAsync({
        artwork: f.artwork.artwork,
        custodyAuthority: f.roles.custody,
        expectedRevision,
        nextRevision: expectedRevision + 1,
        action,
        collector,
      }),
    ]);
  }
  await custody(1, registry.CustodyAction.DispatchFromKatha, null);
  await f.rejects(secondary);
  await custody(2, registry.CustodyAction.ReceiveByCollector, f.roles.seller.address);
  await f.rejects(secondary); // Initial inspection has no collector scope.
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
      reason: registry.ConditionReason.PreResale,
      inspectorId: uuid(),
      inspectedAt: clock.unixTimestamp,
    }),
  ]);
  const [conditionReport] = await registry.findReportPda({ reportId });
  const approved = { ...secondary, conditionReport };
  await f.sendCheck(approved);
  await f.rejects({ ...secondary, conditionReport: f.artwork.initialCondition });
  clock.unixTimestamp += f.settings.inspectionValiditySeconds;
  f.client.svm.setClock(clock);
  await f.sendCheck(approved); // Inclusive 30-day validity boundary.
  clock.unixTimestamp += 1n;
  f.client.svm.setClock(clock);
  await f.rejects(approved);
  clock.unixTimestamp -= f.settings.inspectionValiditySeconds + 1n;
  f.client.svm.setClock(clock);
  await custody(3, registry.CustodyAction.DispatchFromCollector, null);
  await f.rejects(approved);
  await custody(4, registry.CustodyAction.ReceiveAtKatha, null);
  await f.rejects(approved); // Return changes custody revision; old approval cannot revive.
}, 30_000);
