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
