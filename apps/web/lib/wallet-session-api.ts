import {
  artworkRegistrationReviewSchema,
  artworkRegistrationRequestSchema,
  metadataPreparationRequestSchema,
  preparedDocumentResponseSchema,
  type ArtworkRegistrationRequest,
} from "@katha/shared";
import {
  ARTWORK_MEDIA_MAX_BYTES,
  artworkMediaUploadSchema,
  artworkMediaUpdateSchema,
  artworkMediaResponseSchema,
  type ArtworkMediaUpload,
  type ArtworkMediaUpdate,
} from "@katha/shared";
import {
  artworkDraftCreateRequestSchema,
  artworkDraftUpdateRequestSchema,
  artworkDraftResponseSchema,
  artworkDraftReadResponseSchema,
  artworkDraftParamsSchema,
  type ArtworkDraftCreateRequest,
  type ArtworkDraftUpdateRequest,
  artworkDraftListQuerySchema,
  artworkDraftListResponseSchema,
  type Pagination,
  walletPermissionsSchema,
  artistCreateRequestSchema,
  artistIdParamsSchema,
  artistVerificationRequestSchema,
  artistResponseSchema,
  type ArtistCreateRequest,
  operationReceiptRequestSchema,
  operationReceiptResponseSchema,
  unsignedOperationResponseSchema,
  type UnsignedOperationResponse,
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletVerifyRequestSchema,
  walletSessionResponseSchema,
  type WalletChallengeRequest,
  type WalletVerifyRequest,
} from "@katha/shared";
import { publicApiOrigin } from "./public-api.ts";

export class WalletSessionApiError extends Error {
  readonly code:
    | "UNAUTHENTICATED"
    | "FORBIDDEN"
    | "CONFLICT"
    | "NOT_FOUND"
    | "INVALID_REQUEST"
    | "UNAVAILABLE";
  constructor(
    code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "CONFLICT"
      | "NOT_FOUND"
      | "INVALID_REQUEST"
      | "UNAVAILABLE",
  ) {
    super("Wallet session request failed.");
    this.code = code;
  }
}

export function createWalletSessionApi(
  origin: string,
  send: typeof fetch = globalThis.fetch,
) {
  const base = publicApiOrigin(origin);
  async function request(
    path: string,
    body: unknown,
    token?: string,
    signal?: AbortSignal,
    method: "POST" | "GET" | "PATCH" = "POST",
  ) {
    const response = await send(new URL(path, base), {
      method,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.any([
        AbortSignal.timeout(10_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (path === "/auth/logout" && (response.status === 204 || response.status === 401))
      return null;
    if (response.status === 401) throw new WalletSessionApiError("UNAUTHENTICATED");
    const codes = {
      400: "INVALID_REQUEST",
      403: "FORBIDDEN",
      404: "NOT_FOUND",
      409: "CONFLICT",
      413: "INVALID_REQUEST",
      415: "INVALID_REQUEST",
    } as const;
    const code = codes[response.status as keyof typeof codes];
    if (code) throw new WalletSessionApiError(code);
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
    )
      throw new WalletSessionApiError("UNAVAILABLE");
    return response.json() as Promise<unknown>;
  }
  return {
    async readRegistration(kathaId: string, token: string, signal: AbortSignal) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const result = artworkRegistrationReviewSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}/registration`,
          undefined,
          token,
          signal,
          "GET",
        ),
      );
      if (result.kathaId !== path.kathaId)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareMetadata(
      kathaId: string,
      expectedUpdatedAt: string,
      token: string,
      signal: AbortSignal,
    ) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const input = metadataPreparationRequestSchema.parse({ expectedUpdatedAt });
      const result = preparedDocumentResponseSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}/documents/metadata`,
          input,
          token,
          signal,
        ),
      );
      if (result.kathaId !== path.kathaId || result.uri === null)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareRegistration(
      kathaId: string,
      input: ArtworkRegistrationRequest,
      token: string,
      signal: AbortSignal,
    ) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const data = artworkRegistrationRequestSchema.parse(input);
      const result = unsignedOperationResponseSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}/operations/registration`,
          data,
          token,
          signal,
        ),
      );
      if (
        result.kathaId !== path.kathaId ||
        result.kind !== "REGISTER_ARTWORK" ||
        !data.supportedTransactionVersions.includes(result.transactionVersion)
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readArtworkMedia(kathaId: string, token: string, signal: AbortSignal) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const result = artworkMediaResponseSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}/media`,
          undefined,
          token,
          signal,
          "GET",
        ),
      );
      if (result.kathaId !== path.kathaId)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async uploadArtworkMedia(
      kathaId: string,
      input: ArtworkMediaUpload,
      file: File,
      token: string,
      signal: AbortSignal,
    ) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const data = artworkMediaUploadSchema.parse(input);
      if (
        file.size < 1 ||
        file.size > ARTWORK_MEDIA_MAX_BYTES ||
        file.type !== data.mimeType
      )
        throw new WalletSessionApiError("INVALID_REQUEST");
      const form = new FormData();
      form.set("metadata", JSON.stringify(data));
      form.set("file", file, "upload");
      const result = artworkMediaResponseSchema.parse(
        await request(`/admin/artworks/${path.kathaId}/media`, form, token, signal),
      );
      if (
        result.kathaId !== path.kathaId ||
        result.updatedAt === data.expectedUpdatedAt
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async updateArtworkMedia(
      kathaId: string,
      input: ArtworkMediaUpdate,
      token: string,
      signal: AbortSignal,
    ) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const data = artworkMediaUpdateSchema.parse(input);
      const result = artworkMediaResponseSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}/media`,
          data,
          token,
          signal,
          "PATCH",
        ),
      );
      if (
        result.kathaId !== path.kathaId ||
        result.updatedAt === data.expectedUpdatedAt ||
        result.items.length !== data.items.length ||
        result.items.some((item, index) => item.id !== data.items[index]?.id)
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readArtworkDraft(kathaId: string, token: string, signal: AbortSignal) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const result = artworkDraftReadResponseSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}`,
          undefined,
          token,
          signal,
          "GET",
        ),
      );
      if (result.artwork.kathaId !== path.kathaId)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async createArtworkDraft(
      input: ArtworkDraftCreateRequest,
      token: string,
      signal: AbortSignal,
    ) {
      const data = artworkDraftCreateRequestSchema.parse(input);
      const result = artworkDraftResponseSchema.parse(
        await request("/admin/artworks", data, token, signal),
      );
      if (
        result.artistId !== data.artistId ||
        result.category !== data.category ||
        result.creationYear !== data.creationYear
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async updateArtworkDraft(
      kathaId: string,
      input: ArtworkDraftUpdateRequest,
      token: string,
      signal: AbortSignal,
    ) {
      const path = artworkDraftParamsSchema.parse({ kathaId });
      const result = artworkDraftResponseSchema.parse(
        await request(
          `/admin/artworks/${path.kathaId}`,
          artworkDraftUpdateRequestSchema.parse(input),
          token,
          signal,
          "PATCH",
        ),
      );
      if (
        result.kathaId !== path.kathaId ||
        result.updatedAt === input.expectedUpdatedAt
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async listArtworkDrafts(page: Pagination, token: string, signal: AbortSignal) {
      const checked = artworkDraftListQuerySchema.parse({
        limit: String(page.limit),
        offset: String(page.offset),
      });
      const result = artworkDraftListResponseSchema.parse(
        await request(
          `/admin/artworks?${new URLSearchParams({ limit: String(checked.limit), offset: String(checked.offset) })}`,
          undefined,
          token,
          signal,
          "GET",
        ),
      );
      if (
        result.pagination.limit !== checked.limit ||
        result.pagination.offset !== checked.offset
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async permissions(token: string, signal: AbortSignal) {
      return walletPermissionsSchema.parse(
        await request("/auth/permissions", undefined, token, signal, "GET"),
      );
    },
    async createArtist(input: ArtistCreateRequest, token: string, signal: AbortSignal) {
      const result = artistResponseSchema.parse(
        await request(
          "/admin/artists",
          artistCreateRequestSchema.parse(input),
          token,
          signal,
        ),
      );
      if (result.verificationStatus !== "UNVERIFIED" || result.slug !== input.slug)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readArtist(artistId: string, token: string, signal: AbortSignal) {
      const { artistId: id } = artistIdParamsSchema.parse({ artistId });
      const result = artistResponseSchema.parse(
        await request(`/verifier/artists/${id}`, undefined, token, signal, "GET"),
      );
      if (result.id !== id) throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async verifyArtist(
      artistId: string,
      input: { confirmed: true },
      token: string,
      signal: AbortSignal,
    ) {
      const { artistId: id } = artistIdParamsSchema.parse({ artistId });
      const result = artistResponseSchema.parse(
        await request(
          `/verifier/artists/${id}/verification`,
          artistVerificationRequestSchema.parse(input),
          token,
          signal,
        ),
      );
      if (result.id !== id || result.verificationStatus !== "VERIFIED")
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async receipt(
      operation: UnsignedOperationResponse,
      transactionBase64: string,
      token: string,
      signal: AbortSignal,
    ) {
      const parsed = unsignedOperationResponseSchema.parse(operation);
      return operationReceiptResponseSchema.parse(
        await request(
          `/operations/${parsed.operationId}/receipts`,
          operationReceiptRequestSchema.parse({
            preparationId: parsed.preparationId,
            transactionBase64,
          }),
          token,
          signal,
        ),
      );
    },
    async challenge(input: WalletChallengeRequest, signal: AbortSignal) {
      return walletChallengeResponseSchema.parse(
        await request(
          "/auth/challenge",
          walletChallengeRequestSchema.parse(input),
          undefined,
          signal,
        ),
      );
    },
    async verify(input: WalletVerifyRequest, signal: AbortSignal) {
      return walletSessionResponseSchema.parse(
        await request(
          "/auth/verify",
          walletVerifyRequestSchema.parse(input),
          undefined,
          signal,
        ),
      );
    },
    async logout(token: string) {
      await request("/auth/logout", undefined, token);
    },
  };
}
export type WalletSessionApi = ReturnType<typeof createWalletSessionApi>;
