import { expect, it } from "vitest";
import {
  AccountRole,
  addSignersToInstruction,
  generateKeyPairSigner,
  type Address,
  type TransactionSigner,
} from "@solana/kit";
import { randomUUID } from "node:crypto";
import { fetchToken } from "@solana-program/token";
import { readOperatorAuthorization } from "../src/governance.js";
import {
  buildCreateListingTransaction,
  buildPurchaseListingTransaction,
  buildCancelListingTransaction,
} from "../src/marketplace.js";
import { readListingDelegates } from "./fixtures/core-plugins.js";
import * as registry from "../src/generated/registry/index.js";
import * as market from "../src/generated/marketplace/index.js";
import { setupGovernance } from "./fixtures/governance.js";

async function register(
  f: Awaited<ReturnType<typeof setupGovernance>>,
  signer: TransactionSigner,
  serial: number,
) {
  return registry.getRegisterArtworkInstructionAsync({
    registrationAuthority: signer,
    kathaId: `KATHA-PAUBHA-${String(serial).padStart(6, "0")}`,
    artistId: f.artistId,
    creatorWallet: f.roles.artist.address,
    category: registry.ArtworkCategory.Paubha,
    creationYear: 2026,
    authorshipEvidenceHash: new Uint8Array(32).fill(serial),
  });
}

it("activates through genuine Squads, removes legacy fallback, permits multiple registrars and revokes prepared operations", async () => {
  const f = await setupGovernance();
  const config = registry.getKathaConfigDecoder().decode(f.bytes(f.registryConfig));
  expect(config.registrationAuthority).toBe(f.governance);
  expect(config.custodyAuthority).toBe(f.roles.custody.address);
  // The former role wallet cannot omit governance/grants or borrow the vault's privilege.
  await expect(
    f.client.sendTransaction([await register(f, f.roles.seller, 20)]),
  ).rejects.toThrow();
  const first = await f.grant(f.roles.seller.address, 4);
  const second = await f.grant(f.roles.buyerB.address, 4);
  await f.client.sendTransaction([
    await f.extend(await register(f, f.roles.seller, 20)),
  ]);
  await f.client.sendTransaction([
    await f.extend(await register(f, f.roles.buyerB, 21), f.roles.buyerB.address),
  ]);
  const prepared = await f.extend(await register(f, f.roles.seller, 22));
  await f.govern([
    await registry.getUpdateRoleGrantInstructionAsync({
      authority: f.authority,
      grant: first,
      expectedRevision: 1n,
      roles: 4,
      enabled: false,
      expiresAt: 0n,
    }),
  ]);
  await expect(f.client.sendTransaction([prepared])).rejects.toThrow();
  const [artwork] = await registry.findArtworkPda({ kathaId: "KATHA-PAUBHA-000022" });
  expect(f.client.svm.getAccount(artwork).exists).toBe(false);
  expect(registry.getRoleGrantDecoder().decode(f.bytes(second)).enabled).toBe(true);
  // Another wallet's canonical grant is never accepted for this signer.
  const wrong = {
    ...prepared,
    accounts: prepared.accounts.map((a) =>
      a.address === first ? { ...a, address: second } : a,
    ),
  };
  await expect(f.client.sendTransaction([wrong])).rejects.toThrow();
}, 30_000);

it("rejects expired grants, unknown permission bits, stale revisions and self-verification", async () => {
  const f = await setupGovernance();
  const expiresAt = f.clock + 2n;
  const grant = await f.grant(f.roles.seller.address, 4 | 8, expiresAt);
  await f.client.sendTransaction([
    await f.extend(await register(f, f.roles.seller, 30)),
  ]);
  const [artwork] = await registry.findArtworkPda({ kathaId: "KATHA-PAUBHA-000030" });
  await expect(
    f.client.sendTransaction([
      await f.extend(
        await registry.getVerifyArtworkInstructionAsync({
          artwork,
          verifierAuthority: f.roles.seller,
          expectedAuthorshipEvidenceHash: new Uint8Array(32).fill(30),
        }),
      ),
    ]),
  ).rejects.toThrow();
  for (const fields of [
    { expectedRevision: 0n, roles: 4 },
    { expectedRevision: 1n, roles: 128 },
  ]) {
    await expect(
      f.govern([
        await registry.getUpdateRoleGrantInstructionAsync({
          authority: f.authority,
          grant,
          enabled: true,
          expiresAt: 0n,
          ...fields,
        }),
      ]),
    ).rejects.toThrow();
  }
  const clock = f.client.svm.getClock();
  clock.unixTimestamp = expiresAt;
  f.client.svm.setClock(clock);
  await expect(
    f.client.sendTransaction([await f.extend(await register(f, f.roles.seller, 31))]),
  ).rejects.toThrow();
}, 30_000);

it("limits guardians to pause, disable and hold; governance alone can enable and unpause", async () => {
  const f = await setupGovernance();
  const guardian = f.roles.outsider;
  const guardianGrant = await f.grant(guardian.address, 64);
  const registrarGrant = await f.grant(f.roles.seller.address, 4);
  const guarded = <
    T extends {
      accounts?: readonly { address: typeof guardian.address; role: AccountRole }[];
    },
  >(
    ix: T,
  ) => ({
    ...ix,
    accounts: [
      ...(ix.accounts ?? []),
      { address: guardianGrant, role: AccountRole.READONLY },
    ],
  });
  const pause = (expectedRevision: bigint, pauses: number) =>
    registry.getSetGovernancePauseInstructionAsync({
      authority: guardian,
      expectedRevision,
      pauses,
    });
  await f.client.sendTransaction([guarded(await pause(1n, 7))]);
  await expect(
    f.client.sendTransaction([await f.extend(await register(f, f.roles.seller, 40))]),
  ).rejects.toThrow();
  await expect(
    f.client.sendTransaction([guarded(await pause(2n, 0))]),
  ).rejects.toThrow();
  await f.client.sendTransaction([
    guarded(
      await registry.getUpdateRoleGrantInstructionAsync({
        authority: guardian,
        grant: registrarGrant,
        expectedRevision: 1n,
        roles: 4,
        enabled: false,
        expiresAt: 0n,
      }),
    ),
  ]);
  await expect(
    f.client.sendTransaction([
      guarded(
        await registry.getUpdateRoleGrantInstructionAsync({
          authority: guardian,
          grant: registrarGrant,
          expectedRevision: 2n,
          roles: 4,
          enabled: true,
          expiresAt: 0n,
        }),
      ),
    ]),
  ).rejects.toThrow();
  await f.govern([
    await registry.getSetGovernancePauseInstructionAsync({
      authority: f.authority,
      expectedRevision: 2n,
      pauses: 0,
    }),
  ]);
  await f.client.sendTransaction([
    guarded(
      await registry.getPlaceArtworkHoldInstructionAsync({
        authority: guardian,
        artwork: f.artwork.artwork,
        expectedRevision: 3n,
        reasonHash: new Uint8Array(32).fill(7),
      }),
    ),
  ]);
  await expect(
    f.govern([
      await registry.getClearArtworkHoldInstructionAsync({
        authority: f.authority,
        artwork: f.artwork.artwork,
        conditionReport: f.artwork.initialCondition,
        expectedRevision: 4n,
      }),
    ]),
  ).rejects.toThrow();
  const governance = registry
    .getRegistryGovernanceDecoder()
    .decode(f.bytes(f.governance));
  expect(governance.holds[0]?.artwork).toBe(f.artwork.artwork);
  expect(governance.custodyIdentity).toBe(f.roles.custody.address);
}, 30_000);

it("rejects unconfigured and forged grant accounts without allocating artwork", async () => {
  const f = await setupGovernance();
  const instruction = await f.extend(await register(f, f.roles.seller, 50));
  await expect(f.client.sendTransaction([instruction])).rejects.toThrow();
  const unrelated = await generateKeyPairSigner();
  const wrong = {
    ...instruction,
    accounts: instruction.accounts.map((a, i) =>
      i === instruction.accounts.length - 2 ? { ...a, address: unrelated.address } : a,
    ),
  };
  await expect(f.client.sendTransaction([wrong])).rejects.toThrow();
  expect(market.getMarketplaceConfigDecoder().decode(f.bytes(f.config)).version).toBe(
    2,
  );
}, 30_000);

it.each([1, 2])(
  "settles existing version-%s listing bytes after activation without requiring former verifier grants",
  async (version) => {
    const f = await setupGovernance();
    const artwork = f.artwork.artwork;
    await f.govern([
      await f.extend(
        await market.getInitializeSaleTermsInstructionAsync({
          authority: f.authority,
          artwork,
          artistPayout: f.roles.artist.address,
        }),
        f.squads.vault,
      ),
    ]);
    await f.client.sendTransaction([
      await f.extend(
        await market.getCreateListingWithFeesInstructionAsync({
          config: f.config,
          registryConfig: f.registryConfig,
          artwork,
          conditionReport: f.artwork.initialCondition,
          seller: f.roles.seller,
          collection: f.collection,
          price: f.settings.examplePrice,
          expiresAt: f.clock + 3600n,
          expectedRevision: 0n,
          expectedFeeRevision: 1n,
          expectedCommissionBps: 1000,
          expectedSecondaryRoyaltyBps: 0,
        }),
      ),
    ]);
    const [listing] = await market.findListingPda({ asset: f.artwork.asset });
    if (version === 1) {
      // Explicit legacy byte fixture: current creation intentionally cannot create v1.
      // Its layout/economics remain supported by the genuine purchase instruction.
      const original = f.client.svm.getAccount(listing);
      if (!original.exists) throw new Error("Missing listing");
      const record = market.getListingRecordDecoder().decode(original.data);
      f.client.svm.setAccount({
        ...original,
        data: Uint8Array.from(
          market.getListingRecordEncoder().encode({ ...record, version: 1 }),
        ),
      });
    }
    const beforeTreasury = (await fetchToken(f.client.rpc, f.tokenAccounts.treasury))
      .data.amount;
    await f.client.sendTransaction([
      await f.extend(
        await market.getPurchaseListingInstructionAsync({
          config: f.config,
          registryConfig: f.registryConfig,
          artwork,
          conditionReport: f.artwork.initialCondition,
          seller: f.roles.seller.address,
          collection: f.collection,
          buyer: f.roles.buyerA,
          paymentMint: f.mint,
          buyerTokens: f.tokenAccounts.buyerA,
          sellerTokens: f.tokenAccounts.seller,
          artistTokens: f.tokenAccounts.artist,
          treasuryTokens: f.tokenAccounts.treasury,
          listingFees: f.listingFees,
          expectedRevision: 1n,
          expectedPrice: f.settings.examplePrice,
        }),
        f.roles.buyerA.address,
      ),
    ]);
    const asset = f.client.svm.getAccount(f.artwork.asset);
    if (!asset.exists) throw new Error("Missing Core asset");
    expect(readListingDelegates(asset).owner).toBe(f.roles.buyerA.address);
    const commission = version === 1 ? 250n : 1000n;
    expect(
      (await fetchToken(f.client.rpc, f.tokenAccounts.treasury)).data.amount -
        beforeTreasury,
    ).toBe((f.settings.examplePrice * commission) / 10000n);
  },
  30_000,
);

it("runs registration through purchase after activation, rotates verifier and custody operators, and permits held/paused cleanup", async () => {
  const f = await setupGovernance();
  await f.grant(f.roles.seller.address, 1 | 4 | 32);
  await f.grant(f.roles.buyerB.address, 8);
  await f.grant(f.roles.outsider.address, 16);
  const send = async (ix: Parameters<typeof f.extend>[0], actor: TransactionSigner) => {
    f.client.svm.expireBlockhash();
    await f.client.sendTransaction([addSignersToInstruction([actor], ix)]);
  };
  const kathaId = "KATHA-PAUBHA-000060";
  const [artwork] = await registry.findArtworkPda({ kathaId });
  const evidence = new Uint8Array(32).fill(60);
  await send(await f.extend(await register(f, f.roles.seller, 60)), f.roles.seller);
  await send(
    await f.extend(
      await registry.getVerifyArtworkInstructionAsync({
        artwork,
        verifierAuthority: f.roles.buyerB,
        expectedAuthorshipEvidenceHash: evidence,
      }),
      f.roles.buyerB.address,
    ),
    f.roles.buyerB,
  );
  await send(
    await f.extend(
      await registry.getInitializeMetadataInstructionAsync({
        artwork,
        registrationAuthority: f.roles.seller,
        documentHash: new Uint8Array(32).fill(61),
        uri: "https://example.com/governed-artwork.json",
      }),
    ),
    f.roles.seller,
  );
  const uuid = () =>
    new Uint8Array(Buffer.from(randomUUID().replaceAll("-", ""), "hex"));
  const reportId = uuid(),
    inspectorId = uuid();
  const [report] = await registry.findReportPda({ reportId });
  await send(
    await f.extend(
      await registry.getInitializeConditionInstructionAsync({
        artwork,
        verifierAuthority: f.roles.buyerB,
        reportId,
        reportHash: new Uint8Array(32).fill(62),
        grade: registry.ConditionGrade.Good,
        reason: registry.ConditionReason.InitialVerification,
        inspectorId,
        inspectedAt: f.clock,
      }),
      f.roles.buyerB.address,
    ),
    f.roles.buyerB,
  );
  await send(
    await f.extend(
      await registry.getInitializeCustodyInstructionAsync({
        artwork,
        custodyAuthority: f.roles.outsider,
        action: registry.CustodyAction.AttestKathaCustody,
        collector: null,
      }),
      f.roles.outsider.address,
    ),
    f.roles.outsider,
  );
  const [metadataRevision] = await registry.findReviseMintedMetadataRevisionPda({
    artwork,
    nextVersion: 1,
  });
  await send(
    await f.extend(
      await registry.getMintArtworkInstructionAsync({
        artwork,
        metadataRevision,
        initialCondition: report,
        collection: f.collection,
        registrationAuthority: f.roles.seller,
      }),
    ),
    f.roles.seller,
  );
  const [asset] = await registry.findAssetPda({ artwork });
  const [listing] = await market.findListingPda({ asset });
  const [listingFees] = await market.findListingFeesPda({ listing });
  const [head] = await registry.findHeadPda({ artwork });
  const [custody] = await registry.findInitializeCustodyHeadPda({ artwork });
  const [saleTerms] = await market.findSaleTermsPda({ artwork });
  const account = (key: Address) => {
    const value = f.client.svm.getAccount(key);
    if (!value.exists) throw new Error("Missing account");
    return value;
  };
  expect(registry.getCustodyHeadDecoder().decode(account(custody).data)).toMatchObject({
    subject: { __option: "Some", value: f.roles.custody.address },
  });
  // The old custody signing wallet has no grant. Rotation did not assert a move.
  expect(
    registry
      .getArtworkVerificationDecoder()
      .decode(account((await registry.findVerificationPda({ artwork }))[0]).data)
      .verifier,
  ).toBe(f.roles.buyerB.address);
  await f.govern([
    await f.extend(
      await market.getInitializeSaleTermsInstructionAsync({
        authority: f.authority,
        artwork,
        artistPayout: f.roles.artist.address,
      }),
      f.squads.vault,
    ),
  ]);
  const context = async (actor: TransactionSigner) => ({
    cluster: "localnet" as const,
    feePayerAddress: f.roles.bootstrap.address,
    authorityAddress: actor.address,
    supportedTransactionVersions: new Set([0] as const),
    currentBlockHeight: 0n,
    lifetime: {
      blockhash: f.client.svm.latestBlockhash(),
      lastValidBlockHeight: 1000000n,
    },
    chainTime: f.clock,
    authorization: await readOperatorAuthorization(f.client.rpc, actor.address),
  });
  const snapshots = () => ({
    marketplaceConfigAccount: account(f.config),
    registryConfigAccount: account(f.registryConfig),
    artworkAccount: account(artwork),
    assetAccount: account(asset),
    collectionAccount: account(f.collection),
    listingAccount: f.client.svm.getAccount(listing),
    feeScheduleAccount: account(f.feeSchedule),
    listingFeesAccount: f.client.svm.getAccount(listingFees),
    conditionHeadAccount: account(head),
    saleTermsAccount: account(saleTerms),
  });
  const offer = {
    kathaId,
    expectedRevision: 0n,
    price: f.settings.examplePrice.toString(),
    expiresAt: f.clock + 3600n,
  };
  await send(
    (
      await buildCreateListingTransaction(
        await context(f.roles.seller),
        snapshots(),
        offer,
      )
    ).instruction,
    f.roles.seller,
  );
  const prepared = await buildPurchaseListingTransaction(
    await context(f.roles.buyerA),
    snapshots(),
    {
      kathaId,
      expectedRevision: 1n,
      expectedPrice: offer.price,
      buyerAddress: f.roles.buyerA.address,
      paymentMintAddress: f.mint,
    },
  );
  await f.govern([
    await registry.getPlaceArtworkHoldInstructionAsync({
      authority: f.authority,
      artwork,
      expectedRevision: 1n,
      reasonHash: new Uint8Array(32).fill(9),
    }),
  ]);
  await expect(send(prepared.instruction, f.roles.buyerA)).rejects.toThrow();
  const before = readListingDelegates(account(asset));
  await f.govern([
    await registry.getSetGovernancePauseInstructionAsync({
      authority: f.authority,
      expectedRevision: 2n,
      pauses: 7,
    }),
  ]);
  await send(
    (
      await buildCancelListingTransaction(await context(f.roles.seller), snapshots(), {
        kathaId,
        expectedRevision: 1n,
      })
    ).instruction,
    f.roles.seller,
  );
  expect(readListingDelegates(account(asset)).owner).toBe(before.owner);
  expect(readListingDelegates(account(asset)).freeze?.frozen).not.toBe(true);
  await f.govern([
    await registry.getSetGovernancePauseInstructionAsync({
      authority: f.authority,
      expectedRevision: 3n,
      pauses: 0,
    }),
  ]);
  const replacementId = uuid();
  await send(
    await f.extend(
      await registry.getRecordMintedConditionInstructionAsync({
        artwork,
        verifierAuthority: f.roles.buyerB,
        expectedVersion: 1,
        nextVersion: 2,
        expectedOwner: f.roles.seller.address,
        expectedCustodyRevision: 1n,
        reportId: replacementId,
        reportHash: new Uint8Array(32).fill(63),
        inspectorId,
        inspectedAt: f.clock,
        grade: registry.ConditionGrade.Good,
        reason: registry.ConditionReason.ReturnToCustody,
      }),
      f.roles.buyerB.address,
    ),
    f.roles.buyerB,
  );
  const [replacement] = await registry.findReportPda({ reportId: replacementId });
  await f.govern([
    await registry.getClearArtworkHoldInstructionAsync({
      authority: f.authority,
      artwork,
      conditionReport: replacement,
      expectedRevision: 4n,
    }),
  ]);
  // The revoked original verifier is still a valid historical author. Current
  // inspection and stable custody are checked without requiring its former role.
  await send(
    (
      await buildCreateListingTransaction(await context(f.roles.seller), snapshots(), {
        ...offer,
        expectedRevision: 2n,
      })
    ).instruction,
    f.roles.seller,
  );
  const beforeBuyer = (await fetchToken(f.client.rpc, f.tokenAccounts.buyerA)).data
    .amount;
  const finalPurchase = await buildPurchaseListingTransaction(
    await context(f.roles.buyerA),
    snapshots(),
    {
      kathaId,
      expectedRevision: 3n,
      expectedPrice: offer.price,
      buyerAddress: f.roles.buyerA.address,
      paymentMintAddress: f.mint,
    },
  );
  await send(finalPurchase.instruction, f.roles.buyerA);
  expect(readListingDelegates(account(asset)).owner).toBe(f.roles.buyerA.address);
  expect((await fetchToken(f.client.rpc, f.tokenAccounts.buyerA)).data.amount).toBe(
    beforeBuyer - f.settings.examplePrice,
  );
  expect(market.getListingRecordDecoder().decode(account(listing).data)).toMatchObject({
    completedSales: 1n,
    status: market.ListingStatus.Purchased,
  });
}, 30_000);
