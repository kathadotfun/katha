export { createDatabase, validateDatabaseUrl, type Database } from "./connection.js";
export { createArtistStore } from "./artist-store.js";
export type { ArtistStore } from "./artist-store.js";
export {
  artists,
  artistVerificationStatus,
  type ArtistRecord,
  type NewArtistRecord,
} from "./schema/artists.js";
export {
  artworks,
  artworkCategory,
  type ArtworkRecord,
  type NewArtworkRecord,
} from "./schema/artworks.js";
export {
  artworkMedia,
  artworkMediaKind,
  artworkMediaRole,
  mediaVisibility,
  type ArtworkMediaRecord,
  type NewArtworkMediaRecord,
} from "./schema/artwork-media.js";
export {
  artworkMaterials,
  type ArtworkMaterialRecord,
  type NewArtworkMaterialRecord,
} from "./schema/artwork-materials.js";
export {
  attestationStatus,
  attestationCluster,
  artworkMetadataVersions,
  verifications,
  conditionReports,
  conditionGrade,
  conditionReason,
  type ArtworkMetadataVersionRecord,
  type NewArtworkMetadataVersionRecord,
  type VerificationRecord,
  type NewVerificationRecord,
  type ConditionReportRecord,
  type NewConditionReportRecord,
} from "./schema/artwork-attestations.js";
export {
  custodyEvents,
  fulfillmentRequests,
  physicalCustodyState,
  fulfillmentKind,
  fulfillmentStatus,
  type CustodyEventRecord,
  type NewCustodyEventRecord,
  type FulfillmentRequestRecord,
  type NewFulfillmentRequestRecord,
} from "./schema/custody-fulfillment.js";
export {
  wallets,
  walletChallenges,
  walletSessions,
  type WalletRecord,
  type NewWalletRecord,
  type WalletChallengeRecord,
  type NewWalletChallengeRecord,
  type WalletSessionRecord,
  type NewWalletSessionRecord,
} from "./schema/wallet-sessions.js";
export {
  blockchainOperations,
  transactionReceipts,
  blockchainOperationKind,
  blockchainOperationStatus,
  transactionReceiptStatus,
  type BlockchainOperationRecord,
  type NewBlockchainOperationRecord,
  type TransactionReceiptRecord,
  type NewTransactionReceiptRecord,
} from "./schema/blockchain-operations.js";
export {
  indexedEventKind,
  indexedListingStatus,
  indexedEvents,
  indexerCheckpoints,
  artworkOwnership,
  artworkListings,
  artworkSales,
  type IndexedEventRecord,
  type NewIndexedEventRecord,
  type IndexerCheckpointRecord,
  type NewIndexerCheckpointRecord,
  type ArtworkOwnershipRecord,
  type NewArtworkOwnershipRecord,
  type ArtworkListingRecord,
  type NewArtworkListingRecord,
  type ArtworkSaleRecord,
  type NewArtworkSaleRecord,
} from "./schema/blockchain-read-models.js";

export {
  createWalletSessionStore,
  type WalletSessionStore,
} from "./wallet-session-store.js";

export {
  createPublicArtistStore,
  type PublicArtistStore,
} from "./public-artist-store.js";

export {
  createArtworkDraftStore,
  type ArtworkDraftStore,
} from "./artwork-draft-store.js";

export {
  createPublicArtworkStore,
  type PublicArtworkStore,
} from "./public-artwork-store.js";

export {
  createPublicArtworkDetailStore,
  type PublicArtworkDetailStore,
} from "./public-artwork-store.js";

export {
  createDocumentPreparationStore,
  type DocumentPreparationStore,
} from "./document-preparation-store.js";

export {
  createPublicDocumentStore,
  type PublicDocumentStore,
} from "./document-preparation-store.js";

export {
  operationPreparations,
  type NewOperationPreparation,
} from "./schema/operation-preparations.js";
export {
  createOperationPreparationStore,
  type OperationPreparationStore,
} from "./operation-preparation-store.js";
export {
  createArtworkRegistrationStore,
  type ArtworkRegistrationStore,
  type ArtworkRegistrationSnapshot,
} from "./artwork-registration-store.js";

export * from "./artwork-verification-store.js";

export * from "./condition-attestation-store.js";
export {
  createCustodyOperationStore,
  type CustodyOperationStore,
} from "./custody-operation-store.js";
export {
  createArtworkMintStore,
  type ArtworkMintStore,
  type ArtworkMintSnapshot,
} from "./artwork-mint-store.js";
