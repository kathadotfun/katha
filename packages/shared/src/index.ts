export type { JsonValue } from "./json.js";

export {
  artworkCategories,
  artworkCategorySchema,
  kathaIdSchema,
} from "./artwork-identity.js";
export type { ArtworkCategory, KathaId } from "./artwork-identity.js";

export {
  artistAttributionSchema,
  artistProfileSchema,
  artworkDimensionsSchema,
  artworkOriginSchema,
  artworkPublicContentSchema,
  artworkSchema,
  walletAddressSchema,
} from "./artwork-domain.js";
export type {
  ArtistAttribution,
  ArtistProfile,
  Artwork,
  ArtworkDimensions,
  ArtworkOrigin,
  ArtworkPublicContent,
} from "./artwork-domain.js";

export {
  artworkVerificationStateSchema,
  artworkVerificationTransitionSchema,
  physicalCustodyStateSchema,
  physicalCustodyTransitionSchema,
  artworkRegistrationStateSchema,
  artworkRegistrationTransitionSchema,
} from "./artwork-lifecycle.js";
export type {
  ArtworkVerificationState,
  ArtworkVerificationTransition,
  PhysicalCustodyState,
  PhysicalCustodyTransition,
  ArtworkRegistrationState,
  ArtworkRegistrationTransition,
} from "./artwork-lifecycle.js";

export {
  conditionGradeSchema,
  conditionReasonSchema,
  conditionReportCommitmentSchema,
  conditionReportDocumentSchema,
} from "./condition-report.js";
export type {
  ConditionGrade,
  ConditionReason,
  ConditionReportCommitment,
  ConditionReportDocument,
} from "./condition-report.js";

export {
  basisPointsSchema,
  listingPriceSchema,
  listingStatusSchema,
  marketplaceFeeRatesSchema,
  marketplaceFeeScheduleSchema,
  DEFAULT_MARKETPLACE_FEES,
  tokenAmountSchema,
} from "./marketplace.js";
export type {
  BasisPoints,
  ListingPrice,
  ListingStatus,
  MarketplaceFeeRates,
  TokenAmount,
} from "./marketplace.js";

export { canonicalDocumentBytes, sha256Hex } from "./canonical-document.js";

export {
  apiErrors,
  apiErrorCodeSchema,
  apiErrorResponseSchema,
  HTTP_LIMITS,
  paginationQuerySchema,
  paginationResponseSchema,
  paginatedResponseSchema,
  countedPaginationResponseSchema,
  countedPaginatedResponseSchema,
} from "./http.js";
export type { ApiErrorCode, ApiErrorResponse, Pagination } from "./http.js";
export {
  artistSlugSchema,
  artistIdParamsSchema,
  artistCreateRequestSchema,
  artistVerificationRequestSchema,
  artistResponseSchema,
  artistSearchQuerySchema,
  artistSearchItemSchema,
  artistSearchResponseSchema,
} from "./artist-api.js";
export type {
  ArtistCreateRequest,
  ArtistResponse,
  ArtistSearchQuery,
  ArtistSearchResponse,
} from "./artist-api.js";

export {
  walletClusterSchema,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletVerifyRequestSchema,
  walletSessionSchema,
  walletSessionResponseSchema,
  walletSignInMessage,
  validateWalletSignInChallenge,
} from "./wallet-session.js";
export type {
  WalletChallengeRequest,
  WalletChallengeResponse,
  WalletVerifyRequest,
  WalletSession,
} from "./wallet-session.js";

export {
  artistSlugParamsSchema,
  publicArtistSummarySchema,
  publicArtistDetailSchema,
} from "./artist-api.js";
export type { PublicArtistSummary, PublicArtistDetail } from "./artist-api.js";

export {
  artworkDraftCreateRequestSchema,
  artworkDraftResponseSchema,
} from "./artwork-draft-api.js";
export type {
  ArtworkDraftCreateRequest,
  ArtworkDraftResponse,
} from "./artwork-draft-api.js";

export {
  artworkDraftParamsSchema,
  artworkDraftUpdateRequestSchema,
} from "./artwork-draft-api.js";
export type { ArtworkDraftUpdateRequest } from "./artwork-draft-api.js";

export {
  artworkDiscoveryQuerySchema,
  publicArtworkSummarySchema,
  artworkDiscoveryResponseSchema,
} from "./artwork-discovery-api.js";
export type {
  ArtworkDiscoveryQuery,
  PublicArtworkSummary,
} from "./artwork-discovery-api.js";

export {
  artworkDetailParamsSchema,
  artworkDetailQuerySchema,
  publicArtworkDetailSchema,
  type PublicArtworkDetail,
} from "./artwork-detail-api.js";

export {
  metadataPreparationRequestSchema,
  conditionPreparationRequestSchema,
  metadataDocumentSchema,
  preparedDocumentResponseSchema,
  type ConditionPreparationRequest,
} from "./document-preparation.js";

export {
  operationIntentSchema,
  preparedInstructionSchema,
  registryOperationKindSchema,
  unsignedOperationResponseSchema,
  type OperationIntent,
  type UnsignedOperationResponse,
} from "./blockchain-operation.js";
export {
  artworkRegistrationRequestSchema,
  type ArtworkRegistrationRequest,
} from "./artwork-registration-api.js";

export * from "./artwork-verification-api.js";

export * from "./condition-attestation-api.js";
export * from "./custody-api.js";
export * from "./artwork-mint-api.js";
export {
  metadataRevisionRequestSchema,
  type MetadataRevisionRequest,
  metadataRevisionDocumentRequestSchema,
  metadataRevisionReviewSchema,
  type MetadataRevisionDocumentRequest,
  type MetadataRevisionReview,
} from "./metadata-revision-api.js";
export * from "./operation-receipt-api.js";
export * from "./artwork-provenance-api.js";

export * from "./nfc-api.js";

export { walletPermissionsSchema, type WalletPermissions } from "./wallet-session.js";

export {
  artworkDraftListQuerySchema,
  artworkDraftListItemSchema,
  artworkDraftListResponseSchema,
  type ArtworkDraftListResponse,
} from "./artwork-draft-api.js";

export {
  artworkDraftMaterialsSchema,
  artworkDraftReadResponseSchema,
  type ArtworkDraftReadResponse,
} from "./artwork-draft-api.js";

export {
  ARTWORK_MEDIA_MAX_BYTES,
  artworkMediaMimeSchema,
  artworkMediaRoleSchema,
  artworkMediaUploadSchema,
  artworkMediaUpdateSchema,
  artworkMediaResponseSchema,
  type ArtworkMediaUpload,
  type ArtworkMediaUpdate,
  type ArtworkMediaResponse,
} from "./artwork-media-api.js";
export {
  registrationIdentitySchema,
  registrationStatusSchema,
  artworkRegistrationReviewSchema,
  type RegistrationIdentity,
  type ArtworkRegistrationReview,
} from "./artwork-registration-review.js";

export {
  artworkVerificationReviewSchema,
  type ArtworkVerificationReview,
} from "./artwork-registration-review.js";

export {
  conditionInspectionReviewSchema,
  type ConditionInspectionReview,
} from "./condition-inspection.js";

export {
  listingCreateRequestSchema,
  listingCancelRequestSchema,
  listingPreparationResponseSchema,
  artworkListingResponseSchema,
  type ListingPreparationResponse,
  type ListingCreateRequest,
  type ListingCancelRequest,
  type ArtworkListingResponse,
} from "./artwork-listing-api.js";
export {
  listingOperationKindSchema,
  chainOperationKindSchema,
  chainOperationIntentSchema,
} from "./blockchain-operation.js";

export {
  purchaseQuoteRequestSchema,
  purchasePrepareRequestSchema,
  saleDistributionSchema,
  purchaseQuoteTermsSchema,
  purchaseQuoteResponseSchema,
  purchasePreparationResponseSchema,
  type PurchaseQuoteTerms,
  type PurchaseQuoteResponse,
  type PurchaseQuoteRequest,
  type PurchasePrepareRequest,
  type PurchasePreparationResponse,
} from "./artwork-purchase-api.js";

export * from "./collector-api.js";

export * from "./resale-inspection.js";
export * from "./devnet-bootstrap.js";
export * from "./artwork-workflow-api.js";
