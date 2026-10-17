import { expect, it } from "vitest";
import {
  addSignersToInstruction,
  createNoopSigner,
  getAddressDecoder,
  isSignerRole,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import { fetchToken } from "@solana-program/token";
import { setupMarketplaceConfiguration } from "./fixtures/marketplace-configuration.js";
import { createSquads, transferUpgradeAuthority } from "./fixtures/squads.js";
import { readListingDelegates } from "./fixtures/core-plugins.js";
import {
  buildCreateListingTransaction,
  buildPurchaseListingTransaction,
  type MarketplaceTransactionContext,
} from "../src/marketplace.js";
import * as market from "../src/generated/marketplace/index.js";
import * as registry from "../src/generated/registry/index.js";

it.each([false, true])(
  "completes a primary sale preserving attribution, custody and history (multisig handover: %s)",
  primaryJourney,
  30_000,
);

async function primaryJourney(handover: boolean) {
  // Fixture executes actual registration -> verification -> metadata -> inspection
  // -> held custody -> Core mint, with separate artist/seller/platform/buyer roles.
  const f = await setupMarketplaceConfiguration();
  const account = (key: Address) => {
    const value = f.client.svm.getAccount(key);
    if (!value.exists) throw new Error(`Missing synthetic account ${key}`);
    return value;
  };
  const send = (instruction: Instruction, signer: TransactionSigner) => {
    f.client.svm.expireBlockhash();
    return f.client.sendTransaction([addSignersToInstruction([signer], instruction)]);
  };
  const [listing] = await market.findListingPda({ asset: f.artwork.asset });
  const [verification] = await registry.findVerificationPda({
    artwork: f.artwork.artwork,
  });
  const [conditionHead] = await registry.findHeadPda({ artwork: f.artwork.artwork });
  const [custodyHead] = await registry.findInitializeCustodyHeadPda({
    artwork: f.artwork.artwork,
  });
  const [metadataHead] = await registry.findInitializeMetadataHeadPda({
    artwork: f.artwork.artwork,
  });
  const [saleTerms] = await market.findSaleTermsPda({ artwork: f.artwork.artwork });
  const custody = registry.getCustodyHeadDecoder().decode(account(custodyHead).data);
  const historyKeys = [
    f.artwork.artwork,
    verification,
    conditionHead,
    f.artwork.initialCondition,
    custodyHead,
    custody.latestTransition,
    metadataHead,
    f.artwork.metadataRevision,
    f.collection,
    f.secondArtwork.artwork,
    f.secondArtwork.asset,
  ];
  const history = historyKeys.map(account);
  const unchangedHistory = () => expect(historyKeys.map(account)).toEqual(history);
  const artwork = registry
    .getArtworkRecordDecoder()
    .decode(account(f.artwork.artwork).data);
  expect(artwork).toMatchObject({
    kathaId: f.artwork.kathaId,
    artistId: f.artistId,
    creatorWallet: { __option: "Some", value: f.roles.artist.address },
    coreAsset: { __option: "Some", value: f.artwork.asset },
    registeredBy: f.roles.seller.address,
    authorshipEvidenceHash: f.artwork.evidenceHash,
  });
  expect(
    registry.getArtworkVerificationDecoder().decode(account(verification).data),
  ).toMatchObject({
    artwork: f.artwork.artwork,
    verifier: f.roles.verifier.address,
    authorshipEvidenceHash: f.artwork.evidenceHash,
  });
  expect(
    registry.getMetadataHeadDecoder().decode(account(metadataHead).data),
  ).toMatchObject({
    version: 1,
    currentHash: f.artwork.metadataHash,
    currentRevision: f.artwork.metadataRevision,
  });
  expect(
    registry
      .getConditionAttestationDecoder()
      .decode(account(f.artwork.initialCondition).data),
  ).toMatchObject({
    version: 1,
    reason: registry.ConditionReason.InitialVerification,
    reportHash: f.artwork.reportHash,
  });
  expect(custody).toMatchObject({
    state: registry.CustodyState.KathaHeld,
    revision: 1n,
    subject: { __option: "Some", value: f.roles.custody.address },
  });
  expect(readListingDelegates(account(f.artwork.asset)).owner).toBe(
    f.roles.seller.address,
  );

  await f.client.sendTransaction([await f.initialize()]);
  await f.client.sendTransaction([await f.initializeFees()]);
  const terms = (authority: TransactionSigner) =>
    market.getInitializeSaleTermsInstructionAsync({
      artwork: f.artwork.artwork,
      authority,
      artistPayout: f.roles.artist.address,
    });
  await expect(send(await terms(f.roles.outsider), f.roles.outsider)).rejects.toThrow();
  expect(f.client.svm.getAccount(saleTerms).exists).toBe(false);
  unchangedHistory();
  await send(await terms(f.roles.bootstrap), f.roles.bootstrap);
  const immutableTerms = account(saleTerms);
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
  const context = (signer: TransactionSigner): MarketplaceTransactionContext => ({
    cluster: "localnet",
    feePayerAddress: f.roles.bootstrap.address,
    authorityAddress: signer.address,
    supportedTransactionVersions: new Set([0]),
    chainTime: f.clock,
    lifetime: {
      blockhash: f.client.svm.latestBlockhash(),
      lastValidBlockHeight: 1_000_000n,
    },
    currentBlockHeight: 0n,
  });
  const identity = { kathaId: f.artwork.kathaId, expectedRevision: 0n };
  const offer = {
    ...identity,
    price: f.settings.examplePrice.toString(),
    expiresAt: f.clock + 3600n,
  };
  await expect(
    buildCreateListingTransaction(context(f.roles.artist), snapshots(), offer),
  ).rejects.toThrow();
  const created = await buildCreateListingTransaction(
    context(f.roles.seller),
    snapshots(),
    offer,
  );
  await send(created.instruction, f.roles.seller);
  expect(readListingDelegates(account(f.artwork.asset))).toEqual({
    owner: f.roles.seller.address,
    freeze: { frozen: true, authority: "Address", address: listing },
    transfer: { authority: "Address", address: listing },
  });
  expect(market.getListingRecordDecoder().decode(account(listing).data)).toMatchObject({
    status: market.ListingStatus.Active,
    saleKind: market.SaleKind.Primary,
    revision: 1n,
    completedSales: 0n,
    price: f.settings.examplePrice,
    seller: f.roles.seller.address,
    artistPayout: f.roles.artist.address,
  });
  unchangedHistory();
  const amounts = () =>
    Promise.all(
      [
        f.tokenAccounts.buyerA,
        f.tokenAccounts.seller,
        f.tokenAccounts.artist,
        f.tokenAccounts.treasury,
      ].map(async (key) => (await fetchToken(f.client.rpc, key)).data.amount),
    );
  const beforeAmounts = await amounts();
  const beforeAsset = account(f.artwork.asset),
    beforeListing = account(listing);
  const quote = {
    kathaId: f.artwork.kathaId,
    expectedRevision: 1n,
    expectedPrice: f.settings.examplePrice.toString(),
    buyerAddress: f.roles.buyerA.address,
    paymentMintAddress: f.mint,
  };
  const prepared = await buildPurchaseListingTransaction(
    context(f.roles.buyerA),
    snapshots(),
    quote,
  );
  expect(prepared.requiredSignerAddresses).toEqual([
    f.roles.bootstrap.address,
    f.roles.buyerA.address,
  ]);
  expect(
    prepared.instruction.accounts
      .filter((meta) => isSignerRole(meta.role))
      .map((meta) => meta.address),
  ).toEqual([f.roles.buyerA.address]);
  // A different actor cannot spend the buyer's token account. Exercise the program,
  // not just the client quote checks, before settling the approved instruction.
  const wrongBuyer = await market.getPurchaseListingInstructionAsync({
    ...prepared.addresses,
    buyer: f.roles.outsider,
    expectedRevision: 1n,
    expectedPrice: f.settings.examplePrice,
  });
  await expect(send(wrongBuyer, f.roles.outsider)).rejects.toThrow();
  expect(account(f.artwork.asset)).toEqual(beforeAsset);
  expect(account(listing)).toEqual(beforeListing);
  expect(await amounts()).toEqual(beforeAmounts);
  unchangedHistory();

  if (handover) {
    const squads = await createSquads(f.client, f.roles.bootstrap);
    const program = account(registry.KATHA_REGISTRY_PROGRAM_ADDRESS);
    const registryData = getAddressDecoder().decode(program.data.subarray(4, 36));
    const transfer = {
      authority: f.roles.bootstrap,
      newAuthority: createNoopSigner(squads.vault),
      multisig: squads.multisig,
      expectedAuthority: f.roles.bootstrap.address,
      vaultIndex: 0,
      expectedMembers: squads.memberAddresses,
      expectedTimeLock: 0,
    };
    const proposal = await squads.propose(
      [
        await registry.getTransferMultisigAuthorityInstructionAsync({
          ...transfer,
          programData: registryData,
        }),
        await market.getTransferMultisigAuthorityInstructionAsync({
          ...transfer,
          programData: f.programDataAddress,
        }),
      ],
      [f.roles.bootstrap],
    );
    await proposal.approve();
    await proposal.approve(squads.members[1]!);
    await proposal.execute([
      transferUpgradeAuthority(registryData, f.roles.bootstrap, squads.vault),
      transferUpgradeAuthority(f.programDataAddress, f.roles.seller, squads.vault),
    ]);
    expect(
      registry.getKathaConfigDecoder().decode(account(f.registryConfig).data).authority,
    ).toBe(squads.vault);
    expect(
      market.getMarketplaceConfigDecoder().decode(account(f.config).data).authority,
    ).toBe(squads.vault);
    expect(account(saleTerms)).toEqual(immutableTerms);
    expect(account(listing)).toEqual(beforeListing);
    unchangedHistory();
  }
  // The purchase prepared before a root handover retains its exact listing terms.
  const result = await send(prepared.instruction, f.roles.buyerA);
  const afterAmounts = await amounts();
  expect(afterAmounts).toEqual([900_000_000n, 0n, 90_000_000n, 10_000_000n]);
  expect(beforeAmounts[0]! - afterAmounts[0]!).toBe(f.settings.examplePrice);
  expect(
    afterAmounts[2]! - beforeAmounts[2]! + (afterAmounts[3]! - beforeAmounts[3]!),
  ).toBe(f.settings.examplePrice);
  expect(readListingDelegates(account(f.artwork.asset))).toEqual({
    owner: f.roles.buyerA.address,
    freeze: { frozen: false, authority: "Owner", address: null },
    transfer: { authority: "Owner", address: null },
  });
  expect(market.getListingRecordDecoder().decode(account(listing).data)).toMatchObject({
    status: market.ListingStatus.Purchased,
    saleKind: market.SaleKind.Primary,
    revision: 2n,
    completedSales: 1n,
    seller: f.roles.seller.address,
    artistPayout: f.roles.artist.address,
    conditionReport: f.artwork.initialCondition,
    conditionHash: f.artwork.reportHash,
    conditionVersion: 1,
    custodyRevision: 1n,
  });
  const metadata = result.context.transactionMetadata;
  if ("err" in metadata) throw new Error("Successful purchase expected");
  const events = metadata
    .logs()
    .filter((line) => line.startsWith("Program data: "))
    .map((line) =>
      Uint8Array.from(Buffer.from(line.slice("Program data: ".length), "base64")),
    )
    .filter((bytes) =>
      market.ARTWORK_PURCHASED_EVENT_DISCRIMINATOR.every(
        (byte, index) => bytes[index] === byte,
      ),
    )
    .map(market.parseArtworkPurchasedEvent);
  expect(events).toEqual([
    {
      listing,
      artwork: f.artwork.artwork,
      asset: f.artwork.asset,
      seller: f.roles.seller.address,
      buyer: f.roles.buyerA.address,
      artistPayout: f.roles.artist.address,
      treasury: f.roles.treasury.address,
      paymentMint: f.mint,
      price: 100_000_000n,
      sellerProceeds: 0n,
      artistProceeds: 90_000_000n,
      treasuryFee: 10_000_000n,
      saleKind: market.SaleKind.Primary,
      revision: 2n,
      completedSales: 1n,
      conditionReport: f.artwork.initialCondition,
      conditionHash: f.artwork.reportHash,
      conditionVersion: 1,
      custodyRevision: 1n,
      purchasedAt: f.clock,
    },
  ]);
  unchangedHistory();
  expect(account(saleTerms)).toEqual(immutableTerms);
  const settledAsset = account(f.artwork.asset),
    settledListing = account(listing);
  await expect(send(prepared.instruction, f.roles.buyerA)).rejects.toThrow();
  expect(account(f.artwork.asset)).toEqual(settledAsset);
  expect(account(listing)).toEqual(settledListing);
  expect(await amounts()).toEqual(afterAmounts);
  unchangedHistory();
  expect(account(saleTerms)).toEqual(immutableTerms);
}
