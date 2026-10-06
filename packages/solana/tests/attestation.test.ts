import {
  canonicalDocumentBytes,
  sha256Hex,
  type ConditionReportDocument,
} from "@katha/shared";
import {
  address,
  blockhash,
  compileTransaction,
  lamports,
  type Address,
  type EncodedAccount,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import {
  readConditionInspectionScope,
  buildInitializeConditionTransaction,
  buildRecordUnmintedConditionTransaction,
  buildVerifyArtworkTransaction,
  type ConditionAttestationInput,
  type UnmintedConditionAccounts,
} from "../src/attestation.js";
import {
  ArtworkCategory,
  ConditionGrade,
  ConditionReason,
  findArtworkPda,
  findCollectionAuthorityPda,
  findConfigPda,
  findHeadPda,
  findReportPda,
  findVerificationPda,
  getArtworkRecordEncoder,
  getArtworkVerificationEncoder,
  getConditionAttestationEncoder,
  getConditionHeadEncoder,
  getKathaConfigEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
  parseInitializeConditionInstruction,
  parseRecordUnmintedConditionInstruction,
  parseVerifyArtworkInstruction,
} from "../src/generated/registry/index.js";
import type { RegistryTransactionContext } from "../src/registration.js";

const authority = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const payer = address("SysvarRent111111111111111111111111111111111");
const collection = address("Vote111111111111111111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
const kathaId = "KATHA-PAUBHA-000001";
const artistId = "123e4567-e89b-42d3-a456-426614174000";
const reportId = "123e4567-e89b-42d3-a456-426614174001";
const nextReportId = "123e4567-e89b-42d3-a456-426614174002";
const hash = new Uint8Array(32).fill(7);
const context: RegistryTransactionContext = {
  cluster: "localnet",
  feePayerAddress: payer,
  authorityAddress: authority,
  supportedTransactionVersions: new Set([0, 1]),
  lifetime: { blockhash: blockhash(SYSTEM), lastValidBlockHeight: 100n },
  currentBlockHeight: 1n,
};

function account(
  accountAddress: Address,
  bytes: ReadonlyUint8Array,
  size = bytes.length,
): EncodedAccount & { exists: true } {
  const data = new Uint8Array(size);
  data.set(bytes);
  return {
    exists: true,
    address: accountAddress,
    programAddress: REGISTRY,
    data,
    space: BigInt(size),
    lamports: lamports(1_000_000n),
    executable: false,
  };
}

async function input(
  id = reportId,
  reason: ConditionReportDocument["reason"] = "INITIAL_VERIFICATION",
): Promise<ConditionAttestationInput> {
  const document: ConditionReportDocument = {
    reportId: id,
    kathaId,
    grade: "GOOD",
    reason,
    inspectorId: artistId,
    verifierWallet: authority,
    inspectedAt: "2033-05-18T03:32:20.123Z",
    reportedAt: "2033-05-18T03:32:30.456Z",
    notes: "Synthetic inspection fixture",
    mediaHashes: ["09".repeat(32)],
  };
  return {
    document,
    commitment: {
      reportId: id,
      kathaId,
      reportHash: await sha256Hex(canonicalDocumentBytes(document)),
    },
    currentUnixTimestamp: 2_000_000_000n,
  };
}

async function fixtures() {
  const [config, configBump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const [artwork, artworkBump] = await findArtworkPda({ kathaId });
  const [verification, verificationBump] = await findVerificationPda({ artwork });
  const [head, headBump] = await findHeadPda({ artwork });
  const reportIdBytes = Uint8Array.from([
    0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x42, 0xd3, 0xa4, 0x56, 0x42, 0x66, 0x14, 0x17,
    0x40, 0x01,
  ]);
  const [report, reportBump] = await findReportPda({ reportId: reportIdBytes });
  const initial = await input();
  const documentHash = Uint8Array.from(
    initial.commitment.reportHash.match(/../g)!,
    (part) => Number.parseInt(part, 16),
  );
  const recordArgs = {
    kathaId,
    artistId,
    creatorWallet: null,
    category: ArtworkCategory.Paubha,
    creationYear: 2025,
    authorshipEvidenceHash: hash,
    collection,
    coreAsset: null,
    registeredBy: payer,
    registeredAt: 1n,
    bump: artworkBump,
  };
  const verificationArgs = {
    artwork,
    authorshipEvidenceHash: hash,
    verifier: authority,
    verifiedAt: 10n,
    bump: verificationBump,
  };
  const headArgs = {
    artwork,
    version: 1,
    currentReport: report,
    currentHash: documentHash,
    bump: headBump,
  };
  const reportArgs = {
    artwork,
    version: 1,
    reportId: reportIdBytes,
    reportHash: documentHash,
    grade: ConditionGrade.Good,
    reason: ConditionReason.InitialVerification,
    inspectorId: reportIdBytes,
    verifier: authority,
    inspectedAt: 1_999_999_940n,
    recordedAt: 2_000_000_000n,
    ownerScope: null,
    custodyRevisionScope: null,
    bump: reportBump,
  };
  const accounts: UnmintedConditionAccounts = {
    configAccount: account(
      config,
      getKathaConfigEncoder().encode({
        authority: payer,
        registrationAuthority: payer,
        verifierAuthority: authority,
        custodyAuthority: payer,
        treasury: payer,
        collection,
        collectionAuthority,
        bump: configBump,
        collectionAuthorityBump,
      }),
    ),
    artworkAccount: account(artwork, getArtworkRecordEncoder().encode(recordArgs), 246),
    verificationAccount: account(
      verification,
      getArtworkVerificationEncoder().encode(verificationArgs),
    ),
    conditionHeadAccount: account(head, getConditionHeadEncoder().encode(headArgs)),
    currentReportAccount: account(
      report,
      getConditionAttestationEncoder().encode(reportArgs),
      201,
    ),
  };
  return {
    accounts,
    recordArgs,
    verificationArgs,
    headArgs,
    reportArgs,
    artwork,
    verification,
    head,
    report,
    initial,
  };
}

describe("Verifier transaction builders", () => {
  let fixture: Awaited<ReturnType<typeof fixtures>>;
  beforeEach(async () => {
    fixture = await fixtures();
  });

  it("encodes the registered evidence commitment and preserves unsigned roles", async () => {
    const result = await buildVerifyArtworkTransaction(context, fixture.accounts, {
      kathaId,
      expectedAuthorshipEvidenceHash: "07".repeat(32),
    });
    expect(
      parseVerifyArtworkInstruction(result.instruction).data
        .expectedAuthorshipEvidenceHash,
    ).toEqual(hash);
    expect(result.addresses.verification).toBe(fixture.verification);
    expect(result.requiredSignerAddresses).toEqual([payer, authority]);
    expect(
      Object.values(compileTransaction(result.transactionMessage).signatures),
    ).toEqual([null, null]);
    expect(result.instruction.accounts.every((meta) => !("signer" in meta))).toBe(true);
    expect(result.transactionMessage.instructions).toHaveLength(1);
  });

  it("commits the exact canonical report with UUID bytes and second-resolution chain time", async () => {
    const result = await buildInitializeConditionTransaction(
      context,
      fixture.accounts,
      fixture.initial,
    );
    const data = parseInitializeConditionInstruction(result.instruction).data;
    expect(result.addresses.head).toBe(fixture.head);
    expect(result.addresses.report).toBe(fixture.report);
    expect(data.reportId).toEqual(fixture.reportArgs.reportId);
    expect(data.reportHash).toEqual(fixture.headArgs.currentHash);
    expect(data.grade).toBe(ConditionGrade.Good);
    expect(data.reason).toBe(ConditionReason.InitialVerification);
    expect(data.inspectedAt).toBe(
      BigInt(Math.floor(Date.parse(fixture.initial.document.inspectedAt) / 1000)),
    );
    expect(result.version).toBe(1);
    expect(new TextDecoder().decode(result.instruction.data)).not.toContain(
      fixture.initial.document.notes,
    );
  });

  it.each(["PRE_SALE", "INSURANCE"] as const)(
    "appends one unminted %s version without mutating snapshots",
    async (reason) => {
      const before = Uint8Array.from(fixture.accounts.conditionHeadAccount.data);
      const result = await buildRecordUnmintedConditionTransaction(
        context,
        fixture.accounts,
        { ...(await input(nextReportId, reason)), expectedVersion: 1 },
      );
      const data = parseRecordUnmintedConditionInstruction(result.instruction).data;
      expect(data.expectedVersion).toBe(1);
      expect(data.nextVersion).toBe(2);
      expect(data.reason).toBe(
        reason === "PRE_SALE" ? ConditionReason.PreSale : ConditionReason.Insurance,
      );
      expect(result.version).toBe(2);
      expect(result.addresses.report).not.toBe(fixture.report);
      expect(fixture.accounts.conditionHeadAccount.data).toEqual(before);
    },
  );

  it.each([
    ["EXCELLENT", ConditionGrade.Excellent],
    ["GOOD", ConditionGrade.Good],
    ["FAIR", ConditionGrade.Fair],
    ["POOR", ConditionGrade.Poor],
    ["DAMAGED", ConditionGrade.Damaged],
  ] as const)(
    "preserves the %s grade in generated encoding",
    async (grade, encodedGrade) => {
      const document = { ...fixture.initial.document, grade };
      const commitment = {
        ...fixture.initial.commitment,
        reportHash: await sha256Hex(canonicalDocumentBytes(document)),
      };
      const prepared = await buildInitializeConditionTransaction(
        context,
        fixture.accounts,
        { ...fixture.initial, document, commitment },
      );
      expect(parseInitializeConditionInstruction(prepared.instruction).data.grade).toBe(
        encodedGrade,
      );
    },
  );

  it("rejects incorrect verifier roles, authored hash, identities, and collection", async () => {
    for (const invalid of ["00".repeat(32), "08".repeat(32), "bad"])
      await expect(
        buildVerifyArtworkTransaction(context, fixture.accounts, {
          kathaId,
          expectedAuthorshipEvidenceHash: invalid,
        }),
      ).rejects.toThrow();
    await expect(
      buildVerifyArtworkTransaction(
        { ...context, authorityAddress: payer },
        fixture.accounts,
        { kathaId, expectedAuthorshipEvidenceHash: "07".repeat(32) },
      ),
    ).rejects.toThrow();
    for (const record of [
      { ...fixture.recordArgs, collection: payer },
      { ...fixture.recordArgs, bump: (fixture.recordArgs.bump + 1) % 256 },
      { ...fixture.recordArgs, kathaId: "KATHA-PAUBHA-000002" },
      { ...fixture.recordArgs, category: ArtworkCategory.Thangka },
    ])
      await expect(
        buildVerifyArtworkTransaction(
          context,
          {
            ...fixture.accounts,
            artworkAccount: account(
              fixture.artwork,
              getArtworkRecordEncoder().encode(record),
              246,
            ),
          },
          { kathaId, expectedAuthorshipEvidenceHash: "07".repeat(32) },
        ),
      ).rejects.toThrow();
  });

  it("rejects substituted, missing, executable, truncated, and wrong-discriminator snapshots", async () => {
    for (const key of [
      "configAccount",
      "artworkAccount",
      "verificationAccount",
    ] as const) {
      const original = fixture.accounts[key];
      const wrongDiscriminator = Uint8Array.from(original.data);
      wrongDiscriminator.fill(0, 0, 8);
      for (const invalid of [
        { ...original, exists: false },
        { ...original, address: payer },
        { ...original, programAddress: SYSTEM },
        { ...original, executable: true },
        { ...original, data: wrongDiscriminator },
        account(original.address, original.data.subarray(0, 8)),
      ])
        await expect(
          buildInitializeConditionTransaction(
            context,
            { ...fixture.accounts, [key]: invalid },
            fixture.initial,
          ),
        ).rejects.toThrow();
    }
  });

  it("rejects document tampering, mismatched commitment and verifier, invalid IDs/times, and initial reasons", async () => {
    for (const invalid of [
      {
        ...fixture.initial,
        document: { ...fixture.initial.document, notes: "Tampered" },
      },
      {
        ...fixture.initial,
        document: { ...fixture.initial.document, verifierWallet: payer },
      },
      {
        ...fixture.initial,
        commitment: { ...fixture.initial.commitment, reportId: nextReportId },
      },
      {
        ...fixture.initial,
        commitment: { ...fixture.initial.commitment, kathaId: "KATHA-THANGKA-000001" },
      },
      { ...fixture.initial, currentUnixTimestamp: 0n },
      { ...fixture.initial, currentUnixTimestamp: 1n },
      await input(reportId.toUpperCase()),
      await input("00000000-0000-0000-0000-000000000000"),
      await input(reportId, "PRE_SALE"),
    ])
      await expect(
        buildInitializeConditionTransaction(context, fixture.accounts, invalid),
      ).rejects.toThrow();
  });

  it("rejects minted artworks and mismatched verification hashes, artwork, or bumps", async () => {
    await expect(
      buildInitializeConditionTransaction(
        context,
        {
          ...fixture.accounts,
          artworkAccount: account(
            fixture.artwork,
            getArtworkRecordEncoder().encode({
              ...fixture.recordArgs,
              coreAsset: collection,
            }),
            246,
          ),
        },
        fixture.initial,
      ),
    ).rejects.toThrow();
    for (const invalid of [
      { ...fixture.verificationArgs, artwork: payer },
      {
        ...fixture.verificationArgs,
        authorshipEvidenceHash: new Uint8Array(32).fill(8),
      },
      { ...fixture.verificationArgs, bump: (fixture.verificationArgs.bump + 1) % 256 },
    ])
      await expect(
        buildInitializeConditionTransaction(
          context,
          {
            ...fixture.accounts,
            verificationAccount: account(
              fixture.verification,
              getArtworkVerificationEncoder().encode(invalid),
            ),
          },
          fixture.initial,
        ),
      ).rejects.toThrow();
  });

  it("rejects stale, overflowing, fractional versions, inappropriate reasons, and report reuse", async () => {
    const next = await input(nextReportId, "PRE_SALE");
    for (const expectedVersion of [0, 2, -1, 1.5, 0xffff_ffff, Number.NaN])
      await expect(
        buildRecordUnmintedConditionTransaction(context, fixture.accounts, {
          ...next,
          expectedVersion,
        }),
      ).rejects.toThrow();
    await expect(
      buildRecordUnmintedConditionTransaction(context, fixture.accounts, {
        ...(await input(reportId, "PRE_SALE")),
        expectedVersion: 1,
      }),
    ).rejects.toThrow();
    for (const reason of [
      "INITIAL_VERIFICATION",
      "POST_DELIVERY",
      "PRE_RESALE",
      "RETURN_TO_CUSTODY",
    ] as const)
      await expect(
        buildRecordUnmintedConditionTransaction(context, fixture.accounts, {
          ...(await input(nextReportId, reason)),
          expectedVersion: 1,
        }),
      ).rejects.toThrow();
  });

  it("rejects corrupted head/current report relationships and owner or custody scope", async () => {
    const next = { ...(await input(nextReportId, "PRE_SALE")), expectedVersion: 1 };
    for (const invalid of [
      { ...fixture.headArgs, artwork: payer },
      { ...fixture.headArgs, currentReport: payer },
      { ...fixture.headArgs, currentHash: hash },
      { ...fixture.headArgs, bump: (fixture.headArgs.bump + 1) % 256 },
    ])
      await expect(
        buildRecordUnmintedConditionTransaction(
          context,
          {
            ...fixture.accounts,
            conditionHeadAccount: account(
              fixture.head,
              getConditionHeadEncoder().encode(invalid),
            ),
          },
          next,
        ),
      ).rejects.toThrow();
    for (const invalid of [
      { ...fixture.reportArgs, artwork: payer },
      { ...fixture.reportArgs, version: 2 },
      { ...fixture.reportArgs, reportHash: hash },
      { ...fixture.reportArgs, ownerScope: payer },
      { ...fixture.reportArgs, custodyRevisionScope: 1n },
      { ...fixture.reportArgs, bump: (fixture.reportArgs.bump + 1) % 256 },
    ])
      await expect(
        buildRecordUnmintedConditionTransaction(
          context,
          {
            ...fixture.accounts,
            currentReportAccount: account(
              fixture.report,
              getConditionAttestationEncoder().encode(invalid),
              201,
            ),
          },
          next,
        ),
      ).rejects.toThrow();
  });
});

describe("Finalized inspection review scope", () => {
  it("reads initial and later unminted condition versions", async () => {
    const f = await fixtures();
    const accounts = {
      ...f.accounts,
      conditionHeadAccount: {
        ...f.accounts.conditionHeadAccount,
        data: Uint8Array.from(f.accounts.conditionHeadAccount.data),
        exists: true as const,
      },
      custodyHeadAccount: { exists: false as const, address: f.artwork },
      assetAccount: { exists: false as const, address: f.artwork },
    };
    expect(
      await readConditionInspectionScope(authority, accounts, kathaId),
    ).toMatchObject({ version: 1, minted: false, scope: null });
    expect(
      await readConditionInspectionScope(
        authority,
        {
          ...accounts,
          conditionHeadAccount: { exists: false, address: f.head },
          currentReportAccount: null,
        },
        kathaId,
      ),
    ).toMatchObject({ version: 0, minted: false, scope: null });
  });
  it("rejects forged current report relationships", async () => {
    const f = await fixtures();
    const accounts = {
      ...f.accounts,
      conditionHeadAccount: {
        ...f.accounts.conditionHeadAccount,
        data: Uint8Array.from(f.accounts.conditionHeadAccount.data),
        exists: true as const,
      },
      currentReportAccount: account(
        f.report,
        getConditionAttestationEncoder().encode({
          ...f.reportArgs,
          reportHash: new Uint8Array(32),
        }),
        201,
      ),
      custodyHeadAccount: { exists: false as const, address: f.artwork },
      assetAccount: { exists: false as const, address: f.artwork },
    };
    await expect(
      readConditionInspectionScope(authority, accounts, kathaId),
    ).rejects.toThrow();
  });
  it("requires the current verifier authority", async () => {
    const f = await fixtures();
    await expect(
      readConditionInspectionScope(
        payer,
        {
          ...f.accounts,
          conditionHeadAccount: {
            ...f.accounts.conditionHeadAccount,
            data: Uint8Array.from(f.accounts.conditionHeadAccount.data),
            exists: true as const,
          },
          custodyHeadAccount: { exists: false, address: f.artwork },
          assetAccount: { exists: false, address: f.artwork },
        },
        kathaId,
      ),
    ).rejects.toThrow();
  });
});
