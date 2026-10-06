import {
  walletChallengeRequestSchema,
  walletChallengeResponseSchema,
  walletVerifyRequestSchema,
  walletSessionResponseSchema,
  type WalletChallengeRequest,
  type WalletVerifyRequest,
} from "@katha/shared";
import { publicApiOrigin } from "./public-api.ts";

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
  ) {
    const response = await send(new URL(path, base), {
      method: "POST",
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
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
    )
      throw new Error("Wallet session request failed.");
    return response.json() as Promise<unknown>;
  }
  return {
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
