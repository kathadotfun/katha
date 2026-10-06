import { z } from "zod";
import { walletAddressSchema } from "./artwork-domain.js";

export const walletClusterSchema = z.enum(["localnet", "devnet"]);
export const walletChallengeRequestSchema = z.strictObject({
  walletAddress: walletAddressSchema,
  cluster: walletClusterSchema,
});
export const walletChallengeResponseSchema = z.strictObject({
  challengeId: z.uuidv4(),
  message: z.string().min(1).max(4096),
  expiresAt: z.iso.datetime(),
});
export const walletVerifyRequestSchema = z.strictObject({
  challengeId: z.uuidv4(),
  walletAddress: walletAddressSchema,
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
export const walletSessionSchema = z.strictObject({
  walletId: z.uuid(),
  walletAddress: walletAddressSchema,
  cluster: walletClusterSchema,
  expiresAt: z.iso.datetime(),
});
export const walletSessionResponseSchema = z.strictObject({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  session: walletSessionSchema,
});
export type WalletChallengeRequest = z.infer<typeof walletChallengeRequestSchema>;
export type WalletChallengeResponse = z.infer<typeof walletChallengeResponseSchema>;
export type WalletVerifyRequest = z.infer<typeof walletVerifyRequestSchema>;
export type WalletSession = z.infer<typeof walletSessionSchema>;

/** The API and browser reconstruct the same exact UTF-8 sign-in statement. */
export function walletSignInMessage(input: {
  origin: string;
  walletAddress: string;
  cluster: WalletSession["cluster"];
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  challengeId: string;
}) {
  return [
    "Katha wallet sign-in",
    "Sign this message to authenticate. This does not authorize a transaction.",
    `Domain: ${new URL(input.origin).host}`,
    `URI: ${input.origin}`,
    `Wallet: ${input.walletAddress}`,
    `Cluster: ${input.cluster}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
    `Expiration Time: ${input.expiresAt}`,
    `Challenge ID: ${input.challengeId}`,
  ].join("\n");
}

export function validateWalletSignInChallenge(
  input: unknown,
  context: { origin: string; walletAddress: string; cluster: WalletSession["cluster"] },
  now = Date.now(),
): WalletChallengeResponse {
  const challenge = walletChallengeResponseSchema.parse(input);
  const lines = challenge.message.split("\n");
  const nonce = lines[6]?.replace(/^Nonce: /, "") ?? "";
  const issuedAt = lines[7]?.replace(/^Issued At: /, "") ?? "";
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(challenge.expiresAt);
  if (
    !/^[0-9a-f]{64}$/.test(nonce) ||
    !z.iso.datetime().safeParse(issuedAt).success ||
    issued > now ||
    now >= expires ||
    expires <= issued ||
    expires - issued > 5 * 60_000 ||
    challenge.message !==
      walletSignInMessage({
        ...context,
        nonce,
        issuedAt,
        expiresAt: challenge.expiresAt,
        challengeId: challenge.challengeId,
      })
  )
    throw new Error("Invalid wallet sign-in challenge.");
  return challenge;
}

// Only the authenticated wallet's current application permissions are exposed.
export const walletPermissionsSchema = z.strictObject({
  session: walletSessionSchema,
  admin: z.boolean(),
  verifier: z.boolean(),
});
export type WalletPermissions = z.infer<typeof walletPermissionsSchema>;
