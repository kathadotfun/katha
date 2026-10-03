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
