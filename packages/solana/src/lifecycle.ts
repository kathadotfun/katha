import {
  canonicalDocumentBytes,
  physicalCustodyTransitionSchema,
  sha256Hex,
  type KathaId,
  type PhysicalCustodyTransition,
} from "@katha/shared";
import {
  compileTransaction,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  type Address,
  type EncodedAccount,
  type Instruction,
  type MaybeEncodedAccount,
  type Rpc,
  type SimulateTransactionApi,
} from "@solana/kit";
import {
  checkAccount,
  equalBytes,
  hexBytes,
  readAuthorizedArtwork,
  type VerifierArtworkAccounts,
} from "./attestation.js";
import { CORE_PROGRAM_ADDRESS, readCoreAsset, readCoreCollection } from "./core.js";
import {
  ConditionReason,
  CustodyAction,
  CustodyState,
  findAssetPda,
  findHeadPda,
  findInitializeCustodyHeadPda,
  findInitializeMetadataHeadPda,
  findReportPda,
  findRevisionPda,
  findReviseMintedMetadataRevisionPda,
  findTransitionCustodyTransitionPda,
  findTransitionPda,
  findVerificationPda,
  getArtworkVerificationDecoder,
  getArtworkVerificationSize,
  getConditionAttestationDecoder,
  getConditionHeadDecoder,
  getConditionHeadSize,
  getCustodyHeadDecoder,
  getMetadataHeadDecoder,
  getMetadataHeadSize,
  getMetadataRevisionDecoder,
  getInitializeCustodyInstruction,
  getTransitionCustodyInstruction,
  getInitializeMetadataInstruction,
  getReviseUnmintedMetadataInstruction,
  getReviseMintedMetadataInstruction,
  getMintArtworkInstruction,
  KathaRegistryAccount,
} from "./generated/registry/index.js";
import {
  nonzeroAddress,
  unsignedMessage,
  type RegistryTransactionContext,
} from "./registration.js";

export class RegistryLifecycleError extends Error {
  constructor(
    public readonly code: "INVALID_INPUT" | "SIMULATION_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RegistryLifecycleError";
  }
}

async function validated<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof RegistryLifecycleError) throw cause;
    throw new RegistryLifecycleError(
      "INVALID_INPUT",
      cause instanceof Error ? cause.message : "Invalid Registry lifecycle input",
      { cause },
    );
  }
}

export type ArtworkLifecycleAccounts = VerifierArtworkAccounts;
export interface CustodyTransitionAccounts extends ArtworkLifecycleAccounts {
  custodyHeadAccount: EncodedAccount;
}
export interface MetadataRevisionAccounts extends ArtworkLifecycleAccounts {
  metadataHeadAccount: EncodedAccount;
  currentRevisionAccount: EncodedAccount;
}
export interface MintedMetadataAccounts extends MetadataRevisionAccounts {
  collectionAccount: EncodedAccount;
  assetAccount: EncodedAccount;
}
export interface ArtworkMintAccounts extends MetadataRevisionAccounts {
  verificationAccount: EncodedAccount;
  conditionHeadAccount: EncodedAccount;
  initialConditionAccount: EncodedAccount;
  custodyHeadAccount: EncodedAccount;
  collectionAccount: EncodedAccount;
  assetAccount: MaybeEncodedAccount;
}
export interface CustodyTransactionInput {
  kathaId: KathaId;
  transition: PhysicalCustodyTransition;
  collector: Address | null;
}
export interface CustodyRevisionInput extends CustodyTransactionInput {
  expectedRevision: bigint;
}
export interface MetadataTransactionInput {
  kathaId: KathaId;
  documentBytes: Uint8Array;
  uri: string;
}
export interface MetadataRevisionInput extends MetadataTransactionInput {
  expectedVersion: number;
}

const STATE = ["UNKNOWN", "KATHA_HELD", "COLLECTOR_HELD", "IN_TRANSIT"] as const;
const ACTION = {
  ATTEST_KATHA_CUSTODY: CustodyAction.AttestKathaCustody,
  ATTEST_COLLECTOR_CUSTODY: CustodyAction.AttestCollectorCustody,
  DISPATCH_FROM_KATHA: CustodyAction.DispatchFromKatha,
  DISPATCH_FROM_COLLECTOR: CustodyAction.DispatchFromCollector,
  RECEIVE_AT_KATHA: CustodyAction.ReceiveAtKatha,
  RECEIVE_BY_COLLECTOR: CustodyAction.ReceiveByCollector,
} as const;

function custodyInput(
  input: CustodyTransactionInput,
  from: (typeof STATE)[number],
  authority: Address,
) {
  const transition = physicalCustodyTransitionSchema.parse(input.transition);
  if (transition.from !== from)
    throw new TypeError("Custody transition does not match current attested state");
  let collector: Address | null = null;
  if (transition.to === "COLLECTOR_HELD") {
    if (input.collector === null)
      throw new TypeError("Collector custody requires a subject");
    collector = nonzeroAddress(input.collector);
    if (collector === authority)
      throw new TypeError("Collector custody must identify a distinct custodian");
  } else if (input.collector !== null)
    throw new TypeError("This custody action does not accept a collector");
  return { action: ACTION[transition.action], collector };
}

async function custodyHead(
  account: EncodedAccount,
  artwork: Address,
  authority: Address,
) {
  const [head, bump] = await findInitializeCustodyHeadPda({ artwork });
  checkAccount(account, head, KathaRegistryAccount.CustodyHead, 115);
  const state = getCustodyHeadDecoder().decode(account.data);
  if (
    state.artwork !== artwork ||
    state.bump !== bump ||
    state.revision < 1n ||
    state.state < CustodyState.KathaHeld ||
    state.state > CustodyState.InTransit
  )
    throw new TypeError("Custody head relationship or state is invalid");
  const [latest] = await findTransitionCustodyTransitionPda({
    artwork,
    nextRevision: state.revision,
  });
  if (state.latestTransition !== latest)
    throw new TypeError("Latest custody transition is not canonical");
  if (state.state === CustodyState.InTransit) {
    if (state.subject.__option !== "None")
      throw new TypeError("Transit custody must have no subject");
  } else {
    if (state.subject.__option !== "Some")
      throw new TypeError("Held custody requires a subject");
    const subject = nonzeroAddress(state.subject.value);
    if (
      (state.state === CustodyState.KathaHeld && subject !== authority) ||
      (state.state === CustodyState.CollectorHeld && subject === authority)
    )
      throw new TypeError("Custody subject does not match the attested state");
  }
  return { head, state };
}

export function buildInitializeCustodyTransaction(
  context: RegistryTransactionContext,
  accounts: ArtworkLifecycleAccounts,
  input: CustodyTransactionInput,
) {
  return validated(async () => {
    const prepared = await readAuthorizedArtwork(
      context,
      accounts,
      input.kathaId,
      "custodyAuthority",
    );
    const args = custodyInput(input, "UNKNOWN", context.authorityAddress);
    const [head] = await findInitializeCustodyHeadPda({ artwork: prepared.artwork });
    const [transition] = await findTransitionPda({ artwork: prepared.artwork });
    const instruction = getInitializeCustodyInstruction({
      config: prepared.config,
      artwork: prepared.artwork,
      head,
      transition,
      custodyAuthority: createNoopSigner(context.authorityAddress),
      ...args,
    });
    return {
      ...unsignedMessage(context, instruction),
      revision: 1n,
      addresses: {
        config: prepared.config,
        artwork: prepared.artwork,
        head,
        transition,
      },
    };
  });
}

export function buildTransitionCustodyTransaction(
  context: RegistryTransactionContext,
  accounts: CustodyTransitionAccounts,
  input: CustodyRevisionInput,
) {
  return validated(async () => {
    const prepared = await readAuthorizedArtwork(
      context,
      accounts,
      input.kathaId,
      "custodyAuthority",
    );
    const current = await custodyHead(
      accounts.custodyHeadAccount,
      prepared.artwork,
      context.authorityAddress,
    );
    if (
      typeof input.expectedRevision !== "bigint" ||
      input.expectedRevision !== current.state.revision ||
      input.expectedRevision >= 0xffff_ffff_ffff_ffffn
    )
      throw new TypeError("Custody revision is stale or cannot advance");
    const args = custodyInput(
      input,
      STATE[current.state.state]!,
      context.authorityAddress,
    );
    const revision = input.expectedRevision + 1n;
    const [transition] = await findTransitionCustodyTransitionPda({
      artwork: prepared.artwork,
      nextRevision: revision,
    });
    const instruction = getTransitionCustodyInstruction({
      config: prepared.config,
      artwork: prepared.artwork,
      head: current.head,
      transition,
      custodyAuthority: createNoopSigner(context.authorityAddress),
      expectedRevision: input.expectedRevision,
      nextRevision: revision,
      ...args,
    });
    return {
      ...unsignedMessage(context, instruction),
      revision,
      addresses: {
        config: prepared.config,
        artwork: prepared.artwork,
        head: current.head,
        transition,
      },
    };
  });
}

async function metadataInput(input: MetadataTransactionInput) {
  if (!(input.documentBytes instanceof Uint8Array))
    throw new TypeError("Metadata must be canonical JSON bytes");
  const bytes = Uint8Array.from(input.documentBytes);
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !equalBytes(bytes, canonicalDocumentBytes(value))
  )
    throw new TypeError("Metadata must be a canonical JSON object");
  const uri = input.uri;
  const parsed = new URL(uri);
  if (
    uri.length > 200 ||
    !/^https?:\/\//.test(uri) ||
    !/^[!-~]+$/.test(uri) ||
    !/^[a-zA-Z0-9]/.test(uri.split("://")[1] ?? "") ||
    !["https:", "http:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    uri.includes("@") ||
    uri.includes("#")
  )
    throw new TypeError(
      "Metadata URI must be bounded public HTTP(S) without credentials or fragment",
    );
  // Local HTTP storage is supported; URI content/reachability is validated by the storage/API boundary.
  const documentHash = await sha256Hex(bytes);
  return { documentHash, hashBytes: hexBytes(documentHash), uri };
}

async function metadataCurrent(accounts: MetadataRevisionAccounts, artwork: Address) {
  const [head, bump] = await findInitializeMetadataHeadPda({ artwork });
  checkAccount(
    accounts.metadataHeadAccount,
    head,
    KathaRegistryAccount.MetadataHead,
    getMetadataHeadSize(),
  );
  const state = getMetadataHeadDecoder().decode(accounts.metadataHeadAccount.data);
  if (state.artwork !== artwork || state.bump !== bump || state.version < 1)
    throw new TypeError("Metadata head relationship is invalid");
  const [revision, revisionBump] = await findReviseMintedMetadataRevisionPda({
    artwork,
    nextVersion: state.version,
  });
  // MetadataRevision reserves 200 bytes for its bounded URI.
  checkAccount(
    accounts.currentRevisionAccount,
    revision,
    KathaRegistryAccount.MetadataRevision,
    321,
  );
  const current = getMetadataRevisionDecoder().decode(
    accounts.currentRevisionAccount.data,
  );
  if (
    current.artwork !== artwork ||
    current.bump !== revisionBump ||
    current.version !== state.version ||
    state.currentRevision !== revision ||
    !equalBytes(current.documentHash, state.currentHash)
  )
    throw new TypeError("Metadata revision does not match the current head");
  return { head, state, revision, current };
}

export function buildInitializeMetadataTransaction(
  context: RegistryTransactionContext,
  accounts: ArtworkLifecycleAccounts,
  input: MetadataTransactionInput,
) {
  return validated(async () => {
    const prepared = await readAuthorizedArtwork(
      context,
      accounts,
      input.kathaId,
      "registrationAuthority",
    );
    if (prepared.record.coreAsset.__option !== "None")
      throw new TypeError("Minted metadata requires Core synchronization");
    const metadata = await metadataInput(input);
    const [head] = await findInitializeMetadataHeadPda({ artwork: prepared.artwork });
    const [revision] = await findRevisionPda({ artwork: prepared.artwork });
    const instruction = getInitializeMetadataInstruction({
      config: prepared.config,
      artwork: prepared.artwork,
      head,
      revision,
      registrationAuthority: createNoopSigner(context.authorityAddress),
      documentHash: metadata.hashBytes,
      uri: metadata.uri,
    });
    return {
      ...unsignedMessage(context, instruction),
      version: 1,
      documentHash: metadata.documentHash,
      addresses: { config: prepared.config, artwork: prepared.artwork, head, revision },
    };
  });
}

async function reviseMetadata(
  context: RegistryTransactionContext,
  accounts: MetadataRevisionAccounts | MintedMetadataAccounts,
  input: MetadataRevisionInput,
  minted: boolean,
) {
  const prepared = await readAuthorizedArtwork(
    context,
    accounts,
    input.kathaId,
    "registrationAuthority",
  );
  const current = await metadataCurrent(accounts, prepared.artwork);
  if (
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    input.expectedVersion >= 0xffff_ffff ||
    input.expectedVersion !== current.state.version
  )
    throw new TypeError("Metadata version is stale or cannot advance");
  const metadata = await metadataInput(input);
  const version = input.expectedVersion + 1;
  const [revision] = await findReviseMintedMetadataRevisionPda({
    artwork: prepared.artwork,
    nextVersion: version,
  });
  const args = {
    config: prepared.config,
    artwork: prepared.artwork,
    head: current.head,
    revision,
    registrationAuthority: createNoopSigner(context.authorityAddress),
    expectedVersion: input.expectedVersion,
    nextVersion: version,
    documentHash: metadata.hashBytes,
    uri: metadata.uri,
  };
  let instruction: Instruction;
  if (minted) {
    if (!("assetAccount" in accounts))
      throw new TypeError("Minted metadata needs Core account snapshots");
    const [asset] = await findAssetPda({ artwork: prepared.artwork });
    if (
      prepared.record.coreAsset.__option !== "Some" ||
      prepared.record.coreAsset.value !== asset
    )
      throw new TypeError("Artwork does not bind the canonical Core asset");
    readCoreCollection(
      accounts.collectionAccount,
      prepared.configuration.collection,
      prepared.configuration.collectionAuthority,
    );
    const core = readCoreAsset(
      accounts.assetAccount,
      asset,
      prepared.configuration.collection,
    );
    if (core.name !== input.kathaId || core.uri !== current.current.uri)
      throw new TypeError("Core metadata is out of sync with the Registry revision");
    instruction = getReviseMintedMetadataInstruction({
      ...args,
      currentRevision: current.revision,
      collection: prepared.configuration.collection,
      collectionAuthority: prepared.configuration.collectionAuthority,
      asset,
      coreProgram: CORE_PROGRAM_ADDRESS,
    });
  } else {
    if (prepared.record.coreAsset.__option !== "None")
      throw new TypeError("Minted metadata requires Core synchronization");
    instruction = getReviseUnmintedMetadataInstruction(args);
  }
  return {
    ...unsignedMessage(context, instruction),
    version,
    documentHash: metadata.documentHash,
    addresses: {
      config: prepared.config,
      artwork: prepared.artwork,
      head: current.head,
      revision,
    },
  };
}

export function buildReviseUnmintedMetadataTransaction(
  context: RegistryTransactionContext,
  accounts: MetadataRevisionAccounts,
  input: MetadataRevisionInput,
) {
  return validated(() => reviseMetadata(context, accounts, input, false));
}
export function buildReviseMintedMetadataTransaction(
  context: RegistryTransactionContext,
  accounts: MintedMetadataAccounts,
  input: MetadataRevisionInput,
) {
  return validated(() => reviseMetadata(context, accounts, input, true));
}

export function buildMintArtworkTransaction(
  context: RegistryTransactionContext,
  accounts: ArtworkMintAccounts,
  kathaId: KathaId,
) {
  return validated(async () => {
    const prepared = await readAuthorizedArtwork(
      context,
      accounts,
      kathaId,
      "registrationAuthority",
    );
    if (prepared.record.coreAsset.__option !== "None")
      throw new TypeError("Artwork is already minted");
    const metadata = await metadataCurrent(accounts, prepared.artwork);
    const [verification, verificationBump] = await findVerificationPda({
      artwork: prepared.artwork,
    });
    checkAccount(
      accounts.verificationAccount,
      verification,
      KathaRegistryAccount.ArtworkVerification,
      getArtworkVerificationSize(),
    );
    const verified = getArtworkVerificationDecoder().decode(
      accounts.verificationAccount.data,
    );
    if (
      verified.artwork !== prepared.artwork ||
      verified.bump !== verificationBump ||
      !equalBytes(
        verified.authorshipEvidenceHash,
        prepared.record.authorshipEvidenceHash,
      )
    )
      throw new TypeError("Verification does not authenticate this artwork");
    const [conditionHead, conditionBump] = await findHeadPda({
      artwork: prepared.artwork,
    });
    checkAccount(
      accounts.conditionHeadAccount,
      conditionHead,
      KathaRegistryAccount.ConditionHead,
      getConditionHeadSize(),
    );
    const condition = getConditionHeadDecoder().decode(
      accounts.conditionHeadAccount.data,
    );
    if (
      condition.artwork !== prepared.artwork ||
      condition.bump !== conditionBump ||
      condition.version < 1
    )
      throw new TypeError("Condition head is invalid");
    const reportData = accounts.initialConditionAccount;
    // The report UUID is inside the account; validate ownership/type before using it as a seed.
    checkAccount(
      reportData,
      reportData.address,
      KathaRegistryAccount.ConditionAttestation,
      201,
    );
    const initial = getConditionAttestationDecoder().decode(reportData.data);
    const [initialCondition, reportBump] = await findReportPda({
      reportId: initial.reportId,
    });
    if (
      initialCondition !== reportData.address ||
      initial.bump !== reportBump ||
      initial.artwork !== prepared.artwork ||
      initial.version !== 1 ||
      initial.reason !== ConditionReason.InitialVerification ||
      initial.ownerScope.__option !== "None" ||
      initial.custodyRevisionScope.__option !== "None"
    )
      throw new TypeError("Version-1 initial verification condition is required");
    if (
      condition.version === 1 &&
      (condition.currentReport !== initialCondition ||
        !equalBytes(condition.currentHash, initial.reportHash))
    )
      throw new TypeError("Initial condition and head do not match");
    const custody = await custodyHead(
      accounts.custodyHeadAccount,
      prepared.artwork,
      prepared.configuration.custodyAuthority,
    );
    if (custody.state.state === CustodyState.InTransit)
      throw new TypeError("Minting requires attested held custody");
    readCoreCollection(
      accounts.collectionAccount,
      prepared.configuration.collection,
      prepared.configuration.collectionAuthority,
    );
    const [asset] = await findAssetPda({ artwork: prepared.artwork });
    if (
      accounts.assetAccount.address !== asset ||
      accounts.assetAccount.exists !== false
    )
      throw new TypeError("Canonical Core asset must be absent before minting");
    const instruction = getMintArtworkInstruction({
      config: prepared.config,
      artwork: prepared.artwork,
      verification,
      metadataHead: metadata.head,
      metadataRevision: metadata.revision,
      conditionHead,
      initialCondition,
      custodyHead: custody.head,
      collection: prepared.configuration.collection,
      collectionAuthority: prepared.configuration.collectionAuthority,
      asset,
      registrationAuthority: createNoopSigner(context.authorityAddress),
      coreProgram: CORE_PROGRAM_ADDRESS,
    });
    return {
      ...unsignedMessage(context, instruction),
      addresses: {
        config: prepared.config,
        artwork: prepared.artwork,
        asset,
        collection: prepared.configuration.collection,
      },
    };
  });
}

/** Simulates the unsigned message without replacing its lifetime or broadcasting it. */
export async function simulateRegistryTransaction(
  rpc: Rpc<SimulateTransactionApi>,
  prepared: ReturnType<typeof unsignedMessage>,
) {
  try {
    const wire = getBase64EncodedWireTransaction(
      compileTransaction(prepared.transactionMessage),
    );
    const response = await rpc
      .simulateTransaction(wire, {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
        replaceRecentBlockhash: false,
      })
      .send();
    if (response.value.err !== null)
      throw new RegistryLifecycleError(
        "SIMULATION_FAILED",
        "Registry transaction simulation failed",
        { cause: response.value.err },
      );
    return response;
  } catch (cause) {
    if (cause instanceof RegistryLifecycleError) throw cause;
    throw new RegistryLifecycleError(
      "SIMULATION_FAILED",
      "Registry transaction simulation could not complete",
      { cause },
    );
  }
}
