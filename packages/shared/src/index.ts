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
} from "./http.js";
export type { ApiErrorCode, ApiErrorResponse, Pagination } from "./http.js";
export {
  artistSlugSchema,
  artistIdParamsSchema,
  artistCreateRequestSchema,
  artistVerificationRequestSchema,
  artistResponseSchema,
} from "./artist-api.js";
export type { ArtistCreateRequest, ArtistResponse } from "./artist-api.js";

export {
  walletClusterSchema,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletVerifyRequestSchema,
  walletSessionSchema,
  walletSessionResponseSchema,
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
