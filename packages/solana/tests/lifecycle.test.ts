import {
  canonicalDocumentBytes,
  physicalCustodyTransitionSchema,
  sha256Hex,
} from "@katha/shared";
import { Key } from "@metaplex-foundation/mpl-core";
import { getAssetV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/assetV1AccountData.js";
import { getCollectionV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js";
import { publicKey } from "@metaplex-foundation/umi";
import {
  address,
  blockhash,
  compileTransaction,
  lamports,
  type Address,
  type EncodedAccount,
  type ReadonlyUint8Array,
  type Rpc,
  type SimulateTransactionApi,
} from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
import {
  ArtworkCategory,
  ConditionGrade,
  ConditionReason,
  CustodyAction,
  CustodyState,
  findArtworkPda,
  findAssetPda,
  findCollectionAuthorityPda,
  findConfigPda,
  findHeadPda,
  findInitializeCustodyHeadPda,
  findInitializeMetadataHeadPda,
  findReportPda,
  findReviseMintedMetadataRevisionPda,
  findTransitionCustodyTransitionPda,
  findVerificationPda,
  getArtworkRecordEncoder,
  getArtworkVerificationEncoder,
  getConditionAttestationEncoder,
  getConditionHeadEncoder,
  getCustodyHeadEncoder,
  getMetadataHeadEncoder,
  getMetadataRevisionEncoder,
  getKathaConfigEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
  parseInitializeCustodyInstruction,
  parseTransitionCustodyInstruction,
  parseInitializeMetadataInstruction,
  parseReviseUnmintedMetadataInstruction,
  parseReviseMintedMetadataInstruction,
  parseMintArtworkInstruction,
} from "../src/generated/registry/index.js";
import {
  buildInitializeCustodyTransaction,
  buildTransitionCustodyTransaction,
  buildInitializeMetadataTransaction,
  buildReviseUnmintedMetadataTransaction,
  buildReviseMintedMetadataTransaction,
  buildMintArtworkTransaction,
  simulateRegistryTransaction,
  RegistryLifecycleError,
  type ArtworkMintAccounts,
  type CustodyTransactionInput,
} from "../src/lifecycle.js";
import type { RegistryTransactionContext } from "../src/registration.js";

const registration = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const custody = address("BPFLoaderUpgradeab1e11111111111111111111111");
const collection = address("Vote111111111111111111111111111111111111111");
const payer = address("SysvarRent111111111111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
const kathaId = "KATHA-PAUBHA-000001";
const bytes = canonicalDocumentBytes({ kathaId, title: "Synthetic fixture" });
const uri = "http://127.0.0.1:3001/metadata/fixture.json";
const context: RegistryTransactionContext = {
  cluster: "localnet",
  authorityAddress: registration,
  feePayerAddress: payer,
  supportedTransactionVersions: new Set([0, 1]),
  lifetime: { blockhash: blockhash(SYSTEM), lastValidBlockHeight: 100n },
  currentBlockHeight: 1n,
};
const custodyContext = { ...context, authorityAddress: custody };
const metadataInput = { kathaId, documentBytes: bytes, uri };
const initialInput: CustodyTransactionInput = {
  kathaId,
  transition: { action: "ATTEST_KATHA_CUSTODY", from: "UNKNOWN", to: "KATHA_HELD" },
  collector: null,
};

function account(
  accountAddress: Address,
  dataBytes: ReadonlyUint8Array,
  size = dataBytes.length,
  owner: Address = REGISTRY,
): EncodedAccount & { exists: true; data: Uint8Array } {
  const data = new Uint8Array(size);
  data.set(dataBytes);
  return {
    exists: true,
    address: accountAddress,
    programAddress: owner,
    data,
    space: BigInt(size),
    executable: false,
    lamports: lamports(1_000_000n),
  };
}

async function fixtures() {
  const [config, configBump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const [artwork, artBump] = await findArtworkPda({ kathaId });
  const [asset] = await findAssetPda({ artwork });
  const [verification, verificationBump] = await findVerificationPda({ artwork });
  const [head, headBump] = await findInitializeMetadataHeadPda({ artwork });
  const [revision, revisionBump] = await findReviseMintedMetadataRevisionPda({
    artwork,
    nextVersion: 1,
  });
  const [condition, conditionBump] = await findHeadPda({ artwork });
  const reportId = Uint8Array.from([
    0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x42, 0xd3, 0xa4, 0x56, 0x42, 0x66, 0x14, 0x17,
    0x40, 0x01,
  ]);
  const [report, reportBump] = await findReportPda({ reportId });
  const [custodyHead, custodyBump] = await findInitializeCustodyHeadPda({ artwork });
  const [transition] = await findTransitionCustodyTransitionPda({
    artwork,
    nextRevision: 1n,
  });
  const documentHash = await sha256Hex(bytes);
  const hash = Uint8Array.from(documentHash.match(/../g)!, (part) =>
    Number.parseInt(part, 16),
  );
  const record = {
    kathaId,
    artistId: "123e4567-e89b-42d3-a456-426614174000",
    creatorWallet: null,
    category: ArtworkCategory.Paubha,
    creationYear: 2025,
    authorshipEvidenceHash: new Uint8Array(32).fill(7),
    collection,
    coreAsset: null,
    registeredBy: registration,
    registeredAt: 1n,
    bump: artBump,
  };
  const headArgs = {
    artwork,
    version: 1,
    currentRevision: revision,
    currentHash: hash,
    bump: headBump,
  };
  const revisionArgs = {
    artwork,
    version: 1,
    documentHash: hash,
    uri,
    committedBy: registration,
    committedAt: 1n,
    bump: revisionBump,
  };
  const custodyArgs = {
    artwork,
    revision: 1n,
    state: CustodyState.KathaHeld,
    subject: custody,
    latestTransition: transition,
    bump: custodyBump,
  };
  const reportArgs = {
    artwork,
    version: 1,
    reportId,
    reportHash: new Uint8Array(32).fill(9),
    grade: ConditionGrade.Good,
    reason: ConditionReason.InitialVerification,
    inspectorId: reportId,
    verifier: registration,
    inspectedAt: 1n,
    recordedAt: 2n,
    ownerScope: null,
    custodyRevisionScope: null,
    bump: reportBump,
  };
  const accounts: ArtworkMintAccounts = {
    configAccount: account(
      config,
      getKathaConfigEncoder().encode({
        authority: registration,
        registrationAuthority: registration,
        verifierAuthority: registration,
        custodyAuthority: custody,
        treasury: payer,
        collection,
        collectionAuthority,
        bump: configBump,
        collectionAuthorityBump,
      }),
    ),
    artworkAccount: account(artwork, getArtworkRecordEncoder().encode(record), 246),
    metadataHeadAccount: account(head, getMetadataHeadEncoder().encode(headArgs)),
    currentRevisionAccount: account(
      revision,
      getMetadataRevisionEncoder().encode(revisionArgs),
      321,
    ),
    verificationAccount: account(
      verification,
      getArtworkVerificationEncoder().encode({
        artwork,
        authorshipEvidenceHash: record.authorshipEvidenceHash,
        verifier: registration,
        verifiedAt: 1n,
        bump: verificationBump,
      }),
    ),
    conditionHeadAccount: account(
      condition,
      getConditionHeadEncoder().encode({
        artwork,
        version: 1,
        currentReport: report,
        currentHash: reportArgs.reportHash,
        bump: conditionBump,
      }),
    ),
    initialConditionAccount: account(
      report,
      getConditionAttestationEncoder().encode(reportArgs),
      201,
    ),
    custodyHeadAccount: account(
      custodyHead,
      getCustodyHeadEncoder().encode(custodyArgs),
      115,
    ),
    collectionAccount: account(
      collection,
      getCollectionV1AccountDataSerializer().serialize({
        key: Key.CollectionV1,
        updateAuthority: publicKey(collectionAuthority),
        name: "Katha",
        uri,
        numMinted: 0,
        currentSize: 0,
      }),
      undefined,
      CORE_PROGRAM_ADDRESS,
    ),
    assetAccount: { exists: false, address: asset },
  };
  const assetAccount = account(
    asset,
    getAssetV1AccountDataSerializer().serialize({
      key: Key.AssetV1,
      owner: publicKey(payer),
      updateAuthority: { __kind: "Collection", fields: [publicKey(collection)] },
      name: kathaId,
      uri,
      seq: null,
    }),
    undefined,
    CORE_PROGRAM_ADDRESS,
  );
  const mintedAccounts = {
    ...accounts,
    artworkAccount: account(
      artwork,
      getArtworkRecordEncoder().encode({ ...record, coreAsset: asset }),
      246,
    ),
    assetAccount,
  };
  return {
    accounts,
    mintedAccounts,
    artwork,
    asset,
    record,
    headArgs,
    revisionArgs,
    custodyArgs,
    reportArgs,
    documentHash,
  };
}

describe("Registry lifecycle preparation", () => {
  let f: Awaited<ReturnType<typeof fixtures>>;
  beforeEach(async () => {
    f = await fixtures();
  });

  it("prepares both initial custody states without changing ownership or signing", async () => {
    for (const collector of [null, payer]) {
      const input: CustodyTransactionInput =
        collector === null
          ? initialInput
          : {
              kathaId,
              transition: {
                action: "ATTEST_COLLECTOR_CUSTODY",
                from: "UNKNOWN",
                to: "COLLECTOR_HELD",
              },
              collector,
            };
      const result = await buildInitializeCustodyTransaction(
        custodyContext,
        f.accounts,
        input,
      );
      expect(result.revision).toBe(1n);
      expect(parseInitializeCustodyInstruction(result.instruction).data.action).toBe(
        collector === null
          ? CustodyAction.AttestKathaCustody
          : CustodyAction.AttestCollectorCustody,
      );
      expect(result.requiredSignerAddresses).toEqual([payer, custody]);
      expect(
        Object.values(compileTransaction(result.transactionMessage).signatures),
      ).toEqual([null, null]);
    }
  });

  it.each([
    [
      CustodyState.KathaHeld,
      "DISPATCH_FROM_KATHA",
      "KATHA_HELD",
      "IN_TRANSIT",
      null,
      custody,
    ],
    [
      CustodyState.CollectorHeld,
      "DISPATCH_FROM_COLLECTOR",
      "COLLECTOR_HELD",
      "IN_TRANSIT",
      null,
      payer,
    ],
    [
      CustodyState.InTransit,
      "RECEIVE_AT_KATHA",
      "IN_TRANSIT",
      "KATHA_HELD",
      null,
      null,
    ],
    [
      CustodyState.InTransit,
      "RECEIVE_BY_COLLECTOR",
      "IN_TRANSIT",
      "COLLECTOR_HELD",
      payer,
      null,
    ],
  ] as const)(
    "prepares state %s action %s with its exact successor",
    async (state, action, from, to, collector, subject) => {
      const custodyHeadAccount = account(
        f.accounts.custodyHeadAccount.address,
        getCustodyHeadEncoder().encode({ ...f.custodyArgs, state, subject }),
        115,
      );
      const result = await buildTransitionCustodyTransaction(
        custodyContext,
        { ...f.accounts, custodyHeadAccount },
        {
          kathaId,
          transition: physicalCustodyTransitionSchema.parse({ action, from, to }),
          collector,
          expectedRevision: 1n,
        },
      );
      const data = parseTransitionCustodyInstruction(result.instruction).data;
      expect(data.expectedRevision).toBe(1n);
      expect(data.nextRevision).toBe(2n);
      expect(result.revision).toBe(2n);
    },
  );

  it("hashes canonical metadata and composes initial, unminted and atomic minted revisions", async () => {
    const before = Uint8Array.from(f.mintedAccounts.assetAccount.data);
    const initial = await buildInitializeMetadataTransaction(
      context,
      f.accounts,
      metadataInput,
    );
    expect(initial.documentHash).toBe(f.documentHash);
    expect(parseInitializeMetadataInstruction(initial.instruction).data.uri).toBe(uri);
    const next = { ...metadataInput, expectedVersion: 1 };
    const unminted = await buildReviseUnmintedMetadataTransaction(
      context,
      f.accounts,
      next,
    );
    expect(
      parseReviseUnmintedMetadataInstruction(unminted.instruction).data.nextVersion,
    ).toBe(2);
    const minted = await buildReviseMintedMetadataTransaction(
      context,
      f.mintedAccounts,
      next,
    );
    expect(
      parseReviseMintedMetadataInstruction(minted.instruction).accounts.asset.address,
    ).toBe(f.asset);
    expect(minted.transactionMessage.instructions).toHaveLength(1);
    expect(minted.instruction.accounts.every((meta) => !("signer" in meta))).toBe(true);
    expect(f.mintedAccounts.assetAccount.data).toEqual(before);
  });

  it("derives the only mintable Core address after validated prerequisites", async () => {
    const result = await buildMintArtworkTransaction(context, f.accounts, kathaId);
    expect(result.addresses.asset).toBe(f.asset);
    expect(parseMintArtworkInstruction(result.instruction).accounts.asset.address).toBe(
      f.asset,
    );
    expect(result.requiredSignerAddresses).toEqual([payer, registration]);
    expect(f.accounts.artworkAccount.data).toEqual(
      account(f.artwork, getArtworkRecordEncoder().encode(f.record), 246).data,
    );
  });

  it("rejects wrong roles, expired lifetimes and substituted artwork/configuration", async () => {
    await expect(
      buildInitializeCustodyTransaction(context, f.accounts, initialInput),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      buildInitializeMetadataTransaction(custodyContext, f.accounts, metadataInput),
    ).rejects.toBeInstanceOf(RegistryLifecycleError);
    await expect(
      buildInitializeMetadataTransaction(
        { ...context, currentBlockHeight: 101n },
        f.accounts,
        metadataInput,
      ),
    ).rejects.toThrow();
    for (const key of ["configAccount", "artworkAccount"] as const)
      await expect(
        buildInitializeMetadataTransaction(
          context,
          { ...f.accounts, [key]: { ...f.accounts[key], programAddress: SYSTEM } },
          metadataInput,
        ),
      ).rejects.toThrow();
  });

  it("rejects invalid physical movements, subjects, revisions and forged custody heads", async () => {
    for (const collector of [payer, SYSTEM])
      await expect(
        buildInitializeCustodyTransaction(custodyContext, f.accounts, {
          ...initialInput,
          collector,
        }),
      ).rejects.toThrow();
    await expect(
      buildInitializeCustodyTransaction(custodyContext, f.accounts, {
        kathaId,
        transition: {
          action: "ATTEST_COLLECTOR_CUSTODY",
          from: "UNKNOWN",
          to: "COLLECTOR_HELD",
        },
        collector: custody,
      }),
    ).rejects.toThrow();
    const next = {
      kathaId,
      transition: {
        action: "DISPATCH_FROM_KATHA",
        from: "KATHA_HELD",
        to: "IN_TRANSIT",
      } as const,
      collector: null,
      expectedRevision: 1n,
    };
    for (const expectedRevision of [0n, 2n, -1n, 0xffff_ffff_ffff_ffffn])
      await expect(
        buildTransitionCustodyTransaction(custodyContext, f.accounts, {
          ...next,
          expectedRevision,
        }),
      ).rejects.toThrow();
    for (const invalid of [
      { ...f.custodyArgs, artwork: payer },
      { ...f.custodyArgs, latestTransition: payer },
      { ...f.custodyArgs, subject: payer },
      { ...f.custodyArgs, state: CustodyState.InTransit },
    ])
      await expect(
        buildTransitionCustodyTransaction(
          custodyContext,
          {
            ...f.accounts,
            custodyHeadAccount: account(
              f.accounts.custodyHeadAccount.address,
              getCustodyHeadEncoder().encode(invalid),
              115,
            ),
          },
          next,
        ),
      ).rejects.toThrow();
  });

  it("rejects noncanonical documents, invalid URIs and stale metadata versions", async () => {
    for (const documentBytes of [
      new TextEncoder().encode('{ "x": 1 }'),
      new Uint8Array([255]),
      new TextEncoder().encode("null"),
      new TextEncoder().encode("[1]"),
    ])
      await expect(
        buildInitializeMetadataTransaction(context, f.accounts, {
          ...metadataInput,
          documentBytes,
        }),
      ).rejects.toThrow();
    for (const badUri of [
      "ftp://example.com/a",
      "https://user:secret@example.com/a",
      "https://example.com/a#frag",
      "https://example.com/" + "a".repeat(201),
      "http://",
      "HTTPS://example.com/a",
      " https://example.com/a",
    ])
      await expect(
        buildInitializeMetadataTransaction(context, f.accounts, {
          ...metadataInput,
          uri: badUri,
        }),
      ).rejects.toThrow();
    for (const expectedVersion of [0, 2, 1.5, 0xffff_ffff])
      await expect(
        buildReviseUnmintedMetadataTransaction(context, f.accounts, {
          ...metadataInput,
          expectedVersion,
        }),
      ).rejects.toThrow();
    for (const current of [
      { ...f.revisionArgs, artwork: payer },
      { ...f.revisionArgs, documentHash: new Uint8Array(32) },
      { ...f.revisionArgs, version: 2 },
    ])
      await expect(
        buildReviseUnmintedMetadataTransaction(
          context,
          {
            ...f.accounts,
            currentRevisionAccount: account(
              f.accounts.currentRevisionAccount.address,
              getMetadataRevisionEncoder().encode(current),
              321,
            ),
          },
          { ...metadataInput, expectedVersion: 1 },
        ),
      ).rejects.toThrow();
  });

  it("rejects missing mint accounts, stale conditions, transit and duplicate asset binding", async () => {
    for (const key of [
      "verificationAccount",
      "metadataHeadAccount",
      "currentRevisionAccount",
      "conditionHeadAccount",
      "initialConditionAccount",
      "custodyHeadAccount",
      "collectionAccount",
    ] as const) {
      await expect(
        buildMintArtworkTransaction(
          context,
          { ...f.accounts, [key]: { ...f.accounts[key], exists: false } },
          kathaId,
        ),
      ).rejects.toThrow();
    }
    await expect(
      buildMintArtworkTransaction(context, f.mintedAccounts, kathaId),
    ).rejects.toThrow();
    await expect(
      buildMintArtworkTransaction(
        context,
        { ...f.accounts, assetAccount: { exists: false, address: payer } },
        kathaId,
      ),
    ).rejects.toThrow();
    for (const report of [
      { ...f.reportArgs, version: 2 },
      { ...f.reportArgs, reason: ConditionReason.PreSale },
      { ...f.reportArgs, ownerScope: payer },
    ])
      await expect(
        buildMintArtworkTransaction(
          context,
          {
            ...f.accounts,
            initialConditionAccount: account(
              f.accounts.initialConditionAccount.address,
              getConditionAttestationEncoder().encode(report),
              201,
            ),
          },
          kathaId,
        ),
      ).rejects.toThrow();
    await expect(
      buildMintArtworkTransaction(
        context,
        {
          ...f.accounts,
          custodyHeadAccount: account(
            f.accounts.custodyHeadAccount.address,
            getCustodyHeadEncoder().encode({
              ...f.custodyArgs,
              state: CustodyState.InTransit,
              subject: null,
            }),
            115,
          ),
        },
        kathaId,
      ),
    ).rejects.toThrow();
  });

  it("rejects wrong Core collection, unsynchronized URI, unbound and wrong-path metadata", async () => {
    await expect(
      buildInitializeMetadataTransaction(context, f.mintedAccounts, metadataInput),
    ).rejects.toThrow();
    await expect(
      buildReviseUnmintedMetadataTransaction(context, f.mintedAccounts, {
        ...metadataInput,
        expectedVersion: 1,
      }),
    ).rejects.toThrow();
    await expect(
      buildReviseMintedMetadataTransaction(
        context,
        { ...f.mintedAccounts, artworkAccount: f.accounts.artworkAccount },
        { ...metadataInput, expectedVersion: 1 },
      ),
    ).rejects.toThrow();
    await expect(
      buildReviseMintedMetadataTransaction(
        context,
        {
          ...f.mintedAccounts,
          collectionAccount: {
            ...f.mintedAccounts.collectionAccount,
            programAddress: SYSTEM,
          },
        },
        { ...metadataInput, expectedVersion: 1 },
      ),
    ).rejects.toThrow();
    const wrongUri = account(
      f.accounts.currentRevisionAccount.address,
      getMetadataRevisionEncoder().encode({
        ...f.revisionArgs,
        uri: "https://katha.fun/different",
      }),
      321,
    );
    await expect(
      buildReviseMintedMetadataTransaction(
        context,
        { ...f.mintedAccounts, currentRevisionAccount: wrongUri },
        { ...metadataInput, expectedVersion: 1 },
      ),
    ).rejects.toThrow();
  });

  it("simulates without signatures, replacement blockhash or submission, and reports typed failures", async () => {
    const prepared = await buildInitializeMetadataTransaction(
      context,
      f.accounts,
      metadataInput,
    );
    const response = {
      context: { slot: 1n },
      value: { err: null, logs: [], unitsConsumed: 123n },
    };
    const simulateTransaction = vi.fn(() => ({ send: vi.fn(async () => response) }));
    const rpc = { simulateTransaction } as unknown as Rpc<SimulateTransactionApi>;
    expect(await simulateRegistryTransaction(rpc, prepared)).toBe(response);
    expect(simulateTransaction).toHaveBeenCalledWith(expect.any(String), {
      encoding: "base64",
      commitment: "confirmed",
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
    const failing = {
      simulateTransaction: () => ({
        send: async () => ({
          ...response,
          value: { ...response.value, err: "BlockhashNotFound" },
        }),
      }),
    } as unknown as Rpc<SimulateTransactionApi>;
    await expect(simulateRegistryTransaction(failing, prepared)).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
      cause: "BlockhashNotFound",
    });
    const offline = {
      simulateTransaction: () => ({
        send: async () => {
          throw new Error("Synthetic RPC outage");
        },
      }),
    } as unknown as Rpc<SimulateTransactionApi>;
    await expect(simulateRegistryTransaction(offline, prepared)).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
    });
  });
});
