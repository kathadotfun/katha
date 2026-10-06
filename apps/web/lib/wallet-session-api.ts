import {
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
    method: "POST" | "GET" = "POST",
  ) {
    const response = await send(new URL(path, base), {
      method,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
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
