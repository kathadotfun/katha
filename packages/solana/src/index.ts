export {
  assertOwnedEncodedAccount,
  createKathaRpcClient,
  fetchOwnedEncodedAccount,
  FINALIZED_TRANSACTION_READ_CONFIG,
  resolveKathaRpcConfig,
  selectKathaTransactionVersion,
} from "./client.js";
export type {
  KathaCluster,
  KathaRpcConfig,
  KathaTransactionVersion,
  WalletTransactionVersion,
} from "./client.js";
export {
  buildCreateCoreCollectionInstruction,
  CORE_PROGRAM_ADDRESS,
  readCoreAsset,
  readCoreCollection,
} from "./core.js";
export type { CoreAssetView, CoreCollectionInput, CoreCollectionView } from "./core.js";
export {
  buildInitializePlatformTransaction,
  buildRegisterArtworkTransaction,
} from "./registration.js";
export {
  buildVerifyArtworkTransaction,
  buildInitializeConditionTransaction,
  buildRecordUnmintedConditionTransaction,
} from "./attestation.js";
export type {
  VerifierArtworkAccounts,
  VerifiedArtworkAccounts,
  UnmintedConditionAccounts,
  ArtworkVerificationInput,
  ConditionAttestationInput,
  UnmintedConditionInput,
} from "./attestation.js";
export type {
  RegistryTransactionContext,
  PlatformInitializationInput,
  ArtworkRegistrationInput,
} from "./registration.js";
export {
  buildInitializeCustodyTransaction,
  buildTransitionCustodyTransaction,
  buildInitializeMetadataTransaction,
  buildReviseUnmintedMetadataTransaction,
  buildReviseMintedMetadataTransaction,
  buildMintArtworkTransaction,
  simulateRegistryTransaction,
  RegistryLifecycleError,
} from "./lifecycle.js";
export type {
  ArtworkLifecycleAccounts,
  CustodyTransitionAccounts,
  MetadataRevisionAccounts,
  MintedMetadataAccounts,
  ArtworkMintAccounts,
  CustodyTransactionInput,
  CustodyRevisionInput,
  MetadataTransactionInput,
  MetadataRevisionInput,
} from "./lifecycle.js";

export { validateWalletAddress, verifyWalletSignature } from "./wallet-signature.js";
export {
  createRegistryAuthorityReader,
  readRegistryAuthorities,
} from "./registry-authorities.js";
export type {
  RegistryAuthorities,
  RegistryAuthorityRole,
} from "./registry-authorities.js";

export {
  createOperationChain,
  createOperationChainFromRpc,
  encodeUnsignedRegistryTransaction,
  OperationSimulationError,
  type OperationChain,
  type UnsignedRegistryTransaction,
} from "./operation-preparation.js";
export {
  createArtworkRegistrationReader,
  createArtworkRegistrationReaderFromRpc,
  type ArtworkRegistrationReader,
} from "./artwork-registration-reader.js";

export * from "./artwork-verification-reader.js";

export { buildRecordMintedConditionTransaction } from "./attestation.js";
export type { MintedConditionAccounts } from "./attestation.js";

export * from "./condition-attestation-reader.js";
