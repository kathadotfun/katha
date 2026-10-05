import {
  artworkSchema,
  canonicalDocumentBytes,
  conditionReportCommitmentSchema,
  conditionReportDocumentSchema,
  kathaIdSchema,
  sha256Hex,
  type ConditionReportCommitment,
  type ConditionReportDocument,
  type KathaId,
} from "@katha/shared";
import {
  createNoopSigner,
  type Address,
  type EncodedAccount,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { assertOwnedEncodedAccount } from "./client.js";
import {
  ArtworkCategory,
  ConditionGrade,
  ConditionReason,
  findArtworkPda,
  findHeadPda,
  findReportPda,
  findVerificationPda,
  getArtworkRecordDecoder,
  getArtworkVerificationDecoder,
  getArtworkVerificationSize,
  getConditionAttestationDecoder,
  getConditionHeadDecoder,
  getConditionHeadSize,
  getInitializeConditionInstruction,
  getRecordUnmintedConditionInstruction,
  getVerifyArtworkInstruction,
  identifyKathaRegistryAccount,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  KathaRegistryAccount,
} from "./generated/registry/index.js";
import {
  nonzeroAddress,
  readRegistryConfiguration,
  unsignedMessage,
  type RegistryTransactionContext,
} from "./registration.js";

export interface VerifierArtworkAccounts {
  configAccount: EncodedAccount;
  artworkAccount: EncodedAccount;
}

export interface VerifiedArtworkAccounts extends VerifierArtworkAccounts {
  verificationAccount: EncodedAccount;
}

export interface UnmintedConditionAccounts extends VerifiedArtworkAccounts {
  conditionHeadAccount: EncodedAccount;
  currentReportAccount: EncodedAccount;
}

export interface ArtworkVerificationInput {
  kathaId: KathaId;
  expectedAuthorshipEvidenceHash: string;
}

export interface ConditionAttestationInput {
  document: ConditionReportDocument;
  commitment: ConditionReportCommitment;
  currentUnixTimestamp: bigint;
}

export interface UnmintedConditionInput extends ConditionAttestationInput {
  expectedVersion: number;
}

const CATEGORY = ["MANDALA", "PAUBHA", "THANGKA"] as const;
const GRADE = {
  EXCELLENT: ConditionGrade.Excellent,
  GOOD: ConditionGrade.Good,
  FAIR: ConditionGrade.Fair,
  POOR: ConditionGrade.Poor,
  DAMAGED: ConditionGrade.Damaged,
} as const;
const REASON = {
  INITIAL_VERIFICATION: ConditionReason.InitialVerification,
  PRE_SALE: ConditionReason.PreSale,
  POST_DELIVERY: ConditionReason.PostDelivery,
  PRE_RESALE: ConditionReason.PreResale,
  RETURN_TO_CUSTODY: ConditionReason.ReturnToCustody,
  INSURANCE: ConditionReason.Insurance,
} as const;

export function equalBytes(
  left: ReadonlyUint8Array,
  right: ReadonlyUint8Array,
): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

export function hexBytes(value: string): Uint8Array {
  const result = new Uint8Array(value.length / 2);
  for (let index = 0; index < result.length; index++)
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return result;
}

function uuidBytes(value: string): Uint8Array {
  if (
    value !== value.toLowerCase() ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new TypeError("Report and inspector IDs must be canonical UUIDs");
  return hexBytes(value.replaceAll("-", ""));
}

export function checkAccount(
  account: EncodedAccount,
  expected: Address,
  kind: KathaRegistryAccount,
  size: number,
) {
  assertOwnedEncodedAccount(account, expected, KATHA_REGISTRY_PROGRAM_ADDRESS, size);
  if (
    account.executable ||
    account.data.length !== size ||
    identifyKathaRegistryAccount(account.data) !== kind
  )
    throw new TypeError("Registry account type or allocated size is invalid");
}

export async function readAuthorizedArtwork(
  context: Pick<RegistryTransactionContext, "authorityAddress">,
  accounts: VerifierArtworkAccounts,
  identity: string,
  role:
    | "verifierAuthority"
    | "registrationAuthority"
    | "custodyAuthority" = "verifierAuthority",
) {
  const { config, state } = await readRegistryConfiguration(accounts.configAccount);
  if (state[role] !== nonzeroAddress(context.authorityAddress))
    throw new TypeError(`Configured ${role} is required`);
  const kathaId = kathaIdSchema.parse(identity);
  const [artwork, bump] = await findArtworkPda({ kathaId });
  // Anchor allocates the maximum bounded record size, including unused option space.
  checkAccount(
    accounts.artworkAccount,
    artwork,
    KathaRegistryAccount.ArtworkRecord,
    246,
  );
  const record = getArtworkRecordDecoder().decode(accounts.artworkAccount.data);
  if (
    record.kathaId !== kathaId ||
    record.bump !== bump ||
    record.collection !== state.collection ||
    record.category < ArtworkCategory.Mandala ||
    record.category > ArtworkCategory.Thangka ||
    !kathaId.startsWith(`KATHA-${CATEGORY[record.category]}-`)
  )
    throw new TypeError("Artwork identity, collection, or PDA relationship is invalid");
  return {
    config,
    artwork,
    record,
    configuration: state,
    verifierAuthority: createNoopSigner(state.verifierAuthority),
  };
}

async function verifiedArtwork(
  context: RegistryTransactionContext,
  accounts: VerifiedArtworkAccounts,
  identity: string,
) {
  const prepared = await readAuthorizedArtwork(context, accounts, identity);
  if (prepared.record.coreAsset.__option !== "None")
    throw new TypeError("Minted condition reports require owner and custody scope");
  const [verification, bump] = await findVerificationPda({ artwork: prepared.artwork });
  checkAccount(
    accounts.verificationAccount,
    verification,
    KathaRegistryAccount.ArtworkVerification,
    getArtworkVerificationSize(),
  );
  const attestation = getArtworkVerificationDecoder().decode(
    accounts.verificationAccount.data,
  );
  if (
    attestation.artwork !== prepared.artwork ||
    attestation.bump !== bump ||
    !equalBytes(
      attestation.authorshipEvidenceHash,
      prepared.record.authorshipEvidenceHash,
    )
  )
    throw new TypeError("Verification attestation relationship is invalid");
  return { ...prepared, verification };
}

/** Prepares authentication of an immutable registered authorship commitment. */
export async function buildVerifyArtworkTransaction(
  context: RegistryTransactionContext,
  accounts: VerifierArtworkAccounts,
  input: ArtworkVerificationInput,
) {
  const prepared = await readAuthorizedArtwork(context, accounts, input.kathaId);
  const hash = hexBytes(
    artworkSchema.shape.authorshipEvidenceHash.parse(
      input.expectedAuthorshipEvidenceHash,
    ),
  );
  if (
    hash.every((value) => value === 0) ||
    !equalBytes(hash, prepared.record.authorshipEvidenceHash)
  )
    throw new TypeError(
      "Expected authorship evidence hash does not match registration",
    );
  const [verification] = await findVerificationPda({ artwork: prepared.artwork });
  const instruction = getVerifyArtworkInstruction({
    config: prepared.config,
    artwork: prepared.artwork,
    verification,
    verifierAuthority: prepared.verifierAuthority,
    expectedAuthorshipEvidenceHash: hash,
  });
  return {
    ...unsignedMessage(context, instruction),
    addresses: { config: prepared.config, artwork: prepared.artwork, verification },
  };
}

async function conditionDocument(
  context: RegistryTransactionContext,
  input: ConditionAttestationInput,
) {
  const document = conditionReportDocumentSchema.parse(input.document);
  const commitment = conditionReportCommitmentSchema.parse(input.commitment);
  if (
    commitment.kathaId !== document.kathaId ||
    commitment.reportId !== document.reportId ||
    document.verifierWallet !== context.authorityAddress
  )
    throw new TypeError("Report identity or verifier does not match the operation");
  const reportId = uuidBytes(document.reportId);
  const inspectorId = uuidBytes(document.inspectorId);
  const documentHash = await sha256Hex(canonicalDocumentBytes(document));
  if (commitment.reportHash !== documentHash)
    throw new TypeError("Condition document hash does not match its commitment");
  const inspectedAt = BigInt(Math.floor(Date.parse(document.inspectedAt) / 1000));
  const reportedAt = BigInt(Math.floor(Date.parse(document.reportedAt) / 1000));
  if (
    typeof input.currentUnixTimestamp !== "bigint" ||
    input.currentUnixTimestamp <= 0n ||
    input.currentUnixTimestamp > 0x7fff_ffff_ffff_ffffn ||
    inspectedAt <= 0n ||
    reportedAt > input.currentUnixTimestamp
  )
    throw new TypeError(
      "Condition timestamps must be positive and no later than the chain clock snapshot",
    );
  const [report] = await findReportPda({ reportId });
  return {
    document,
    report,
    args: {
      reportId,
      inspectorId,
      reportHash: hexBytes(documentHash),
      grade: GRADE[document.grade],
      reason: REASON[document.reason],
      inspectedAt,
    },
  };
}

/** Creates version 1 before minting; detailed report content stays off chain. */
export async function buildInitializeConditionTransaction(
  context: RegistryTransactionContext,
  accounts: VerifiedArtworkAccounts,
  input: ConditionAttestationInput,
) {
  const condition = await conditionDocument(context, input);
  if (condition.document.reason !== "INITIAL_VERIFICATION")
    throw new TypeError("Initial condition reason must be INITIAL_VERIFICATION");
  const prepared = await verifiedArtwork(context, accounts, condition.document.kathaId);
  const [head] = await findHeadPda({ artwork: prepared.artwork });
  const instruction = getInitializeConditionInstruction({
    config: prepared.config,
    artwork: prepared.artwork,
    verification: prepared.verification,
    verifierAuthority: prepared.verifierAuthority,
    head,
    report: condition.report,
    ...condition.args,
  });
  return {
    ...unsignedMessage(context, instruction),
    version: 1,
    addresses: {
      config: prepared.config,
      artwork: prepared.artwork,
      verification: prepared.verification,
      head,
      report: condition.report,
    },
  };
}

/** Appends one pre-mint report, preserving the current report and empty ownership scope. */
export async function buildRecordUnmintedConditionTransaction(
  context: RegistryTransactionContext,
  accounts: UnmintedConditionAccounts,
  input: UnmintedConditionInput,
) {
  const condition = await conditionDocument(context, input);
  if (
    condition.document.reason !== "PRE_SALE" &&
    condition.document.reason !== "INSURANCE"
  )
    throw new TypeError("Unminted follow-up reason must be PRE_SALE or INSURANCE");
  const prepared = await verifiedArtwork(context, accounts, condition.document.kathaId);
  const [head, headBump] = await findHeadPda({ artwork: prepared.artwork });
  checkAccount(
    accounts.conditionHeadAccount,
    head,
    KathaRegistryAccount.ConditionHead,
    getConditionHeadSize(),
  );
  const state = getConditionHeadDecoder().decode(accounts.conditionHeadAccount.data);
  if (
    state.artwork !== prepared.artwork ||
    state.bump !== headBump ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.expectedVersion >= 0xffff_ffff ||
    state.version !== input.expectedVersion
  )
    throw new TypeError("Condition head relationship or expected version is invalid");
  checkAccount(
    accounts.currentReportAccount,
    state.currentReport,
    KathaRegistryAccount.ConditionAttestation,
    201,
  );
  const current = getConditionAttestationDecoder().decode(
    accounts.currentReportAccount.data,
  );
  const [currentReport, reportBump] = await findReportPda({
    reportId: current.reportId,
  });
  if (
    currentReport !== state.currentReport ||
    current.bump !== reportBump ||
    current.artwork !== prepared.artwork ||
    current.version !== state.version ||
    !equalBytes(current.reportHash, state.currentHash) ||
    current.ownerScope.__option !== "None" ||
    current.custodyRevisionScope.__option !== "None" ||
    condition.report === currentReport
  )
    throw new TypeError(
      "Current condition report relationship or unminted scope is invalid",
    );
  const version = input.expectedVersion + 1;
  const instruction = getRecordUnmintedConditionInstruction({
    config: prepared.config,
    artwork: prepared.artwork,
    verification: prepared.verification,
    verifierAuthority: prepared.verifierAuthority,
    head,
    report: condition.report,
    expectedVersion: input.expectedVersion,
    nextVersion: version,
    ...condition.args,
  });
  return {
    ...unsignedMessage(context, instruction),
    version,
    addresses: {
      config: prepared.config,
      artwork: prepared.artwork,
      verification: prepared.verification,
      head,
      report: condition.report,
    },
  };
}
