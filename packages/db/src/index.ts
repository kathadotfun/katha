export { createDatabase, validateDatabaseUrl, type Database } from "./connection.js";
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
