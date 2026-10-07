import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import {
  getBase64Encoder,
  getBase64Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
  assertIsTransactionWithinSizeLimit,
  getSignatureFromTransaction,
  getPublicKeyFromAddress,
  verifySignature,
  address,
  AccountRole,
  unwrapOption,
} from "@solana/kit";
import {
  unsignedOperationResponseSchema,
  custodyPreparationRequestSchema,
  type CustodyPreparationRequest,
  sha256Hex,
  registrationIdentitySchema,
  type RegistrationIdentity,
  type ConditionReportDocument,
  conditionReportDocumentSchema,
  canonicalDocumentBytes,
  type UnsignedOperationResponse,
} from "@katha/shared";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  identifyKathaRegistryInstruction,
  KathaRegistryInstruction,
  ArtworkCategory,
  parseKathaRegistryInstruction,
  findArtworkPda,
  findConfigPda,
  findVerificationPda,
  findHeadPda,
  findReportPda,
  findAssetPda,
  findCollectionAuthorityPda,
  findInitializeMetadataHeadPda,
  findReviseMintedMetadataRevisionPda,
  findInitializeCustodyHeadPda,
  CustodyAction,
  findTransitionCustodyTransitionPda,
  ConditionGrade,
  ConditionReason,
} from "@katha/solana/registry";

export type MintTransactionReview = {
  asset: string;
  collection: string;
  collectionAuthority: string;
  initialConditionReportId: string;
  metadataVersion: number;
};
export type CustodyTransactionReview = Pick<
  CustodyPreparationRequest,
  "transition" | "collectorWallet" | "expectedCustodyRevision"
>;
export type ConditionTransactionReview = {
  document: ConditionReportDocument;
  reportHash: string;
  expectedVersion: number;
};
const kinds: Record<
  UnsignedOperationResponse["kind"],
  readonly KathaRegistryInstruction[]
> = {
  REGISTER_ARTWORK: [KathaRegistryInstruction.RegisterArtwork],
  VERIFY_ARTWORK: [KathaRegistryInstruction.VerifyArtwork],
  RECORD_CONDITION: [
    KathaRegistryInstruction.InitializeCondition,
    KathaRegistryInstruction.RecordUnmintedCondition,
    KathaRegistryInstruction.RecordMintedCondition,
  ],
  UPDATE_CUSTODY: [
    KathaRegistryInstruction.InitializeCustody,
    KathaRegistryInstruction.TransitionCustody,
  ],
  MINT_ARTWORK: [KathaRegistryInstruction.MintArtwork],
  REVISE_METADATA: [
    KathaRegistryInstruction.InitializeMetadata,
    KathaRegistryInstruction.ReviseUnmintedMetadata,
    KathaRegistryInstruction.ReviseMintedMetadata,
  ],
};
export function decodeCanonicalTransaction(wire: string) {
  const bytes = getBase64Encoder().encode(wire);
  if (getBase64Decoder().decode(bytes) !== wire)
    throw new Error("Noncanonical transaction.");
  const transaction = getTransactionDecoder().decode(bytes);
  assertIsTransactionWithinSizeLimit(transaction);
  if (getBase64Decoder().decode(getTransactionEncoder().encode(transaction)) !== wire)
    throw new Error("Invalid transaction bytes.");
  return transaction;
}
export async function inspectPreparedTransaction(
  input: unknown,
  context: {
    wallet: string;
    cluster: "localnet" | "devnet";
    kind: UnsignedOperationResponse["kind"];
    kathaId: string;
    registration?: RegistrationIdentity;
    verification?: { authorshipEvidenceHash: string };
    condition?: ConditionTransactionReview;
    custody?: CustodyTransactionReview;
    mint?: MintTransactionReview;
  },
) {
  const operation = unsignedOperationResponseSchema.parse(input);
  const transaction = decodeCanonicalTransaction(operation.transactionBase64);
  const compiled = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  );
  const message = decompileTransactionMessage(compiled);
  const instruction = message.instructions[0];
  if (!("blockhash" in message.lifetimeConstraint))
    throw new Error("Recent blockhash required.");
  if (
    operation.cluster !== context.cluster ||
    operation.kind !== context.kind ||
    operation.kathaId !== context.kathaId ||
    operation.feePayer !== context.wallet ||
    operation.requiredSignerAddresses[0] !== context.wallet ||
    Object.keys(transaction.signatures).length !== 1 ||
    Object.keys(transaction.signatures)[0] !== context.wallet ||
    Object.values(transaction.signatures).some((value) => value !== null) ||
    compiled.version !== operation.transactionVersion ||
    (context.cluster === "localnet" && compiled.version !== 0) ||
    message.feePayer.address !== context.wallet ||
    message.lifetimeConstraint.blockhash !== operation.blockhash ||
    (await sha256Hex(Uint8Array.from(transaction.messageBytes))) !==
      operation.messageHash ||
    message.instructions.length !== 1 ||
    !instruction?.data ||
    instruction.programAddress !== KATHA_REGISTRY_PROGRAM_ADDRESS ||
    !kinds[operation.kind].includes(identifyKathaRegistryInstruction(instruction.data))
  )
    throw new Error("Preparation does not match the requested operation.");
  const parsed = parseKathaRegistryInstruction({
    ...instruction,
    data: instruction.data,
  });
  const [[artwork], [config]] = await Promise.all([
    findArtworkPda({ kathaId: operation.kathaId }),
    findConfigPda(),
  ]);
  if (
    !("artwork" in parsed.accounts) ||
    !("config" in parsed.accounts) ||
    parsed.accounts.artwork.address !== artwork ||
    parsed.accounts.config.address !== config ||
    (parsed.instructionType === KathaRegistryInstruction.RegisterArtwork &&
      parsed.data.kathaId !== operation.kathaId)
  )
    throw new Error("Registry artwork identity mismatch.");
  if (context.registration) {
    const expected = registrationIdentitySchema.parse(context.registration);
    const categories = {
      MANDALA: ArtworkCategory.Mandala,
      PAUBHA: ArtworkCategory.Paubha,
      THANGKA: ArtworkCategory.Thangka,
    };
    if (
      parsed.instructionType !== KathaRegistryInstruction.RegisterArtwork ||
      parsed.data.artistId !== expected.artistId ||
      unwrapOption(parsed.data.creatorWallet) !== expected.creatorWallet ||
      parsed.data.category !== categories[expected.category] ||
      parsed.data.creationYear !== expected.creationYear ||
      Array.from(parsed.data.authorshipEvidenceHash, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("") !== expected.authorshipEvidenceHash
    )
      throw new Error("Registration attribution mismatch.");
  }
  if (context.verification) {
    const [verification] = await findVerificationPda({ artwork });
    if (
      parsed.instructionType !== KathaRegistryInstruction.VerifyArtwork ||
      instruction.accounts?.length !== 5 ||
      instruction.accounts.some(
        (account, index) =>
          account.role !==
          [
            AccountRole.READONLY,
            AccountRole.READONLY,
            AccountRole.WRITABLE,
            AccountRole.WRITABLE_SIGNER,
            AccountRole.READONLY,
          ][index],
      ) ||
      parsed.accounts.verification.address !== verification ||
      parsed.accounts.verifierAuthority.address !== context.wallet ||
      parsed.accounts.systemProgram.address !== "11111111111111111111111111111111" ||
      !/^[0-9a-f]{64}$/.test(context.verification.authorshipEvidenceHash) ||
      Array.from(parsed.data.expectedAuthorshipEvidenceHash, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("") !== context.verification.authorshipEvidenceHash
    )
      throw new Error("Verification commitment mismatch.");
  }
  if (operation.kind === "MINT_ARTWORK") {
    const expected = context.mint;
    if (
      !expected ||
      !Number.isInteger(expected.metadataVersion) ||
      expected.metadataVersion < 1 ||
      expected.metadataVersion > 0xffffffff ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(
        expected.initialConditionReportId,
      )
    )
      throw new Error("Mint review required");
    const reportId = Uint8Array.from(
      expected.initialConditionReportId.replaceAll("-", "").match(/../g)!,
      (v) => Number.parseInt(v, 16),
    );
    const [
      [verification],
      [metadataHead],
      [metadataRevision],
      [conditionHead],
      [initialCondition],
      [custodyHead],
      [collectionAuthority],
      [asset],
    ] = await Promise.all([
      findVerificationPda({ artwork }),
      findInitializeMetadataHeadPda({ artwork }),
      findReviseMintedMetadataRevisionPda({
        artwork,
        nextVersion: expected.metadataVersion,
      }),
      findHeadPda({ artwork }),
      findReportPda({ reportId }),
      findInitializeCustodyHeadPda({ artwork }),
      findCollectionAuthorityPda(),
      findAssetPda({ artwork }),
    ]);
    const accounts = [
      config,
      artwork,
      verification,
      metadataHead,
      metadataRevision,
      conditionHead,
      initialCondition,
      custodyHead,
      address(expected.collection),
      collectionAuthority,
      asset,
      address(context.wallet),
      address("11111111111111111111111111111111"),
      CORE_PROGRAM_ADDRESS,
    ];
    const roles = [
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY,
      AccountRole.READONLY,
    ];
    if (
      parsed.instructionType !== KathaRegistryInstruction.MintArtwork ||
      instruction.data.length !== 8 ||
      expected.asset !== asset ||
      expected.collectionAuthority !== collectionAuthority ||
      instruction.accounts?.length !== accounts.length ||
      instruction.accounts.some(
        (item, i) => item.address !== accounts[i] || item.role !== roles[i],
      )
    )
      throw new Error("Mint binding mismatch");
  }
  if (operation.kind === "UPDATE_CUSTODY") {
    const expected = custodyPreparationRequestSchema
      .pick({ transition: true, collectorWallet: true, expectedCustodyRevision: true })
      .parse(context.custody);
    const revision = BigInt(expected.expectedCustodyRevision);
    const [[head], [transition]] = await Promise.all([
      findInitializeCustodyHeadPda({ artwork }),
      findTransitionCustodyTransitionPda({ artwork, nextRevision: revision + 1n }),
    ]);
    const actions = {
      ATTEST_KATHA_CUSTODY: CustodyAction.AttestKathaCustody,
      ATTEST_COLLECTOR_CUSTODY: CustodyAction.AttestCollectorCustody,
      DISPATCH_FROM_KATHA: CustodyAction.DispatchFromKatha,
      DISPATCH_FROM_COLLECTOR: CustodyAction.DispatchFromCollector,
      RECEIVE_AT_KATHA: CustodyAction.ReceiveAtKatha,
      RECEIVE_BY_COLLECTOR: CustodyAction.ReceiveByCollector,
    };
    if (
      parsed.instructionType !== KathaRegistryInstruction.InitializeCustody &&
      parsed.instructionType !== KathaRegistryInstruction.TransitionCustody
    )
      throw new Error("Custody instruction required");
    const initial =
      parsed.instructionType === KathaRegistryInstruction.InitializeCustody;
    const roles = [
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.WRITABLE,
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY,
    ];
    if (
      initial !== (revision === 0n) ||
      (revision === 0n) !== (expected.transition.from === "UNKNOWN") ||
      parsed.data.action !== actions[expected.transition.action] ||
      unwrapOption(parsed.data.collector) !== expected.collectorWallet ||
      (expected.transition.to === "COLLECTOR_HELD"
        ? !expected.collectorWallet ||
          expected.collectorWallet === context.wallet ||
          /^1{32}$/.test(expected.collectorWallet)
        : expected.collectorWallet !== null) ||
      parsed.accounts.head.address !== head ||
      parsed.accounts.transition.address !== transition ||
      parsed.accounts.custodyAuthority.address !== context.wallet ||
      parsed.accounts.systemProgram.address !== "11111111111111111111111111111111" ||
      instruction.accounts?.length !== roles.length ||
      instruction.accounts.some((item, index) => item.role !== roles[index]) ||
      (parsed.instructionType === KathaRegistryInstruction.TransitionCustody &&
        (parsed.data.expectedRevision !== revision ||
          parsed.data.nextRevision !== revision + 1n))
    )
      throw new Error("Custody movement mismatch");
  }
  if (context.condition) {
    const { document: inputDocument, reportHash, expectedVersion } = context.condition;
    const document = conditionReportDocumentSchema.parse(inputDocument);
    const hex = (bytes: ArrayLike<number>) =>
      Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    const uuid = (value: string) =>
      Uint8Array.from(value.replaceAll("-", "").match(/../g)!, (value) =>
        Number.parseInt(value, 16),
      );
    const [[verification], [head], [report], [custodyHead], [asset]] =
      await Promise.all([
        findVerificationPda({ artwork }),
        findHeadPda({ artwork }),
        findReportPda({ reportId: uuid(document.reportId) }),
        findInitializeCustodyHeadPda({ artwork }),
        findAssetPda({ artwork }),
      ]);
    const grade = {
      EXCELLENT: ConditionGrade.Excellent,
      GOOD: ConditionGrade.Good,
      FAIR: ConditionGrade.Fair,
      POOR: ConditionGrade.Poor,
      DAMAGED: ConditionGrade.Damaged,
    };
    const reason = {
      INITIAL_VERIFICATION: ConditionReason.InitialVerification,
      PRE_SALE: ConditionReason.PreSale,
      POST_DELIVERY: ConditionReason.PostDelivery,
      PRE_RESALE: ConditionReason.PreResale,
      RETURN_TO_CUSTODY: ConditionReason.ReturnToCustody,
      INSURANCE: ConditionReason.Insurance,
    };
    if (
      parsed.instructionType !== KathaRegistryInstruction.InitializeCondition &&
      parsed.instructionType !== KathaRegistryInstruction.RecordUnmintedCondition &&
      parsed.instructionType !== KathaRegistryInstruction.RecordMintedCondition
    )
      throw new Error("Condition instruction required");
    const minted =
      parsed.instructionType === KathaRegistryInstruction.RecordMintedCondition;
    const roles = [
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.WRITABLE,
      ...(minted ? [AccountRole.READONLY, AccountRole.READONLY] : []),
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY,
    ];
    if (
      document.kathaId !== context.kathaId ||
      document.verifierWallet !== context.wallet ||
      (await sha256Hex(canonicalDocumentBytes(document))) !== reportHash ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0 ||
      expectedVersion >= 0xffffffff ||
      hex(parsed.data.reportId) !== hex(uuid(document.reportId)) ||
      hex(parsed.data.inspectorId) !== hex(uuid(document.inspectorId)) ||
      hex(parsed.data.reportHash) !== reportHash ||
      parsed.data.grade !== grade[document.grade] ||
      parsed.data.reason !== reason[document.reason] ||
      parsed.data.inspectedAt !==
        BigInt(Math.floor(Date.parse(document.inspectedAt) / 1000)) ||
      parsed.accounts.verification.address !== verification ||
      parsed.accounts.head.address !== head ||
      parsed.accounts.report.address !== report ||
      parsed.accounts.verifierAuthority.address !== context.wallet ||
      parsed.accounts.systemProgram.address !== "11111111111111111111111111111111" ||
      instruction.accounts?.length !== roles.length ||
      instruction.accounts.some((item, index) => item.role !== roles[index])
    )
      throw new Error("Condition commitment mismatch");
    if (parsed.instructionType === KathaRegistryInstruction.InitializeCondition) {
      if (
        expectedVersion !== 0 ||
        document.scope ||
        document.reason !== "INITIAL_VERIFICATION"
      )
        throw new Error("Initial condition mismatch");
    } else if (
      parsed.data.expectedVersion !== expectedVersion ||
      parsed.data.nextVersion !== expectedVersion + 1 ||
      expectedVersion === 0
    )
      throw new Error("Condition version mismatch");
    if (parsed.instructionType === KathaRegistryInstruction.RecordMintedCondition) {
      if (
        !document.scope ||
        parsed.data.expectedOwner !== document.scope.ownerWallet ||
        parsed.data.expectedCustodyRevision !==
          BigInt(document.scope.custodyRevision) ||
        parsed.accounts.custodyHead.address !== custodyHead ||
        parsed.accounts.asset.address !== asset
      )
        throw new Error("Condition scope mismatch");
    } else if (document.scope)
      throw new Error("Unminted condition cannot have an owner scope");
  }
  return {
    operation,
    transaction: {
      ...transaction,
      lifetimeConstraint: {
        blockhash: message.lifetimeConstraint.blockhash,
        lastValidBlockHeight: BigInt(operation.lastValidBlockHeight),
      },
    },
    accounts: (instruction.accounts ?? []).map((account) => ({
      address: String(account.address),
      role: account.role,
    })),
    program: String(instruction.programAddress),
  };
}
export async function validateSignedTransaction(
  wire: string,
  operation: UnsignedOperationResponse,
) {
  const signed = decodeCanonicalTransaction(wire);
  const prepared = decodeCanonicalTransaction(operation.transactionBase64);
  const wallet = address(operation.feePayer);
  const bytes = signed.signatures[wallet];
  if (
    Object.keys(signed.signatures).length !== 1 ||
    !bytes ||
    signed.messageBytes.length !== prepared.messageBytes.length ||
    !signed.messageBytes.every(
      (byte, index) => byte === prepared.messageBytes[index],
    ) ||
    !(await verifySignature(
      await getPublicKeyFromAddress(wallet),
      bytes,
      signed.messageBytes,
    ))
  )
    throw new Error("Wallet changed or did not sign the prepared transaction.");
  return getSignatureFromTransaction(signed);
}
