import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WalletSessionStore } from "@katha/db";
import { validateWalletAddress, verifyWalletSignature } from "@katha/solana";
import {
  walletChallengeRequestSchema,
  walletVerifyRequestSchema,
  type WalletSession,
} from "@katha/shared";
import type { WalletChallengeRecord } from "@katha/db";
import { DomainError } from "./errors.js";

export const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
export const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export function hashSessionValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export function challengeMessage(
  origin: string,
  walletAddress: string,
  challenge: Pick<
    WalletChallengeRecord,
    "id" | "domain" | "cluster" | "nonce" | "issuedAt" | "expiresAt"
  >,
) {
  return [
    "Katha wallet sign-in",
    "Sign this message to authenticate. This does not authorize a transaction.",
    `Domain: ${challenge.domain}`,
    `URI: ${origin}`,
    `Wallet: ${walletAddress}`,
    `Cluster: ${challenge.cluster.toLowerCase()}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt.toISOString()}`,
    `Expiration Time: ${challenge.expiresAt.toISOString()}`,
    `Challenge ID: ${challenge.id}`,
  ].join("\n");
}

export function createWalletSessions(
  store: WalletSessionStore,
  config: { origin: string; cluster: "localnet" | "devnet" },
  now: () => Date = () => new Date(),
) {
  const domain = new URL(config.origin).host;
  const cluster = config.cluster === "localnet" ? "LOCALNET" : "DEVNET";
  function matches(challenge: WalletChallengeRecord, address: string) {
    return (
      challenge.domain === domain &&
      challenge.cluster === cluster &&
      challenge.message === challengeMessage(config.origin, address, challenge) &&
      challenge.messageHash === hashSessionValue(challenge.message)
    );
  }
  function sessionView(
    address: string,
    walletId: string,
    expiresAt: Date,
  ): WalletSession {
    return {
      walletId,
      walletAddress: address,
      cluster: config.cluster,
      expiresAt: expiresAt.toISOString(),
    };
  }
  function tokenFromHeader(authorization: string | undefined): string {
    const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization ?? "");
    if (!match) throw new DomainError("UNAUTHENTICATED");
    return match[1]!;
  }
  return {
    async challenge(input: unknown) {
      const parsed = walletChallengeRequestSchema.safeParse(input);
      if (!parsed.success || parsed.data.cluster !== config.cluster)
        throw new DomainError("INVALID_REQUEST");
      try {
        validateWalletAddress(parsed.data.walletAddress);
      } catch {
        throw new DomainError("INVALID_REQUEST");
      }
      const issuedAt = now();
      const challenge: Parameters<typeof challengeMessage>[2] = {
        id: randomUUID(),
        domain,
        cluster,
        nonce: randomBytes(32).toString("hex"),
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + CHALLENGE_LIFETIME_MS),
      };
      const message = challengeMessage(
        config.origin,
        parsed.data.walletAddress,
        challenge,
      );
      await store.saveChallenge(parsed.data.walletAddress, {
        ...challenge,
        message,
        messageHash: hashSessionValue(message),
      });
      return {
        challengeId: challenge.id,
        message,
        expiresAt: challenge.expiresAt.toISOString(),
      };
    },
    async verify(input: unknown) {
      const parsed = walletVerifyRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const request = parsed.data;
      const record = await store.findChallenge(request.challengeId);
      const current = now();
      if (
        !record ||
        record.address !== request.walletAddress ||
        !matches(record.challenge, record.address) ||
        record.challenge.consumedAt ||
        current < record.challenge.issuedAt ||
        current >= record.challenge.expiresAt
      )
        throw new DomainError("UNAUTHENTICATED");
      const signature = Buffer.from(request.signature, "base64");
      if (
        signature.length !== 64 ||
        signature.toString("base64") !== request.signature ||
        !(await verifyWalletSignature(
          record.address,
          new TextEncoder().encode(record.challenge.message),
          signature,
        ))
      )
        throw new DomainError("UNAUTHENTICATED");
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(current.getTime() + SESSION_LIFETIME_MS);
      const session = await store.issueSession(
        record.challenge.id,
        record.challenge.walletId,
        hashSessionValue(token),
        expiresAt,
      );
      if (!session) throw new DomainError("UNAUTHENTICATED");
      return {
        token,
        session: sessionView(record.address, session.walletId, session.expiresAt),
      };
    },
    async authenticate(authorization: string | undefined): Promise<WalletSession> {
      const token = tokenFromHeader(authorization);
      const record = await store.findSession(hashSessionValue(token), domain, cluster);
      if (
        !record ||
        record.session.revokedAt ||
        now() >= record.session.expiresAt ||
        !matches(record.challenge, record.address)
      )
        throw new DomainError("UNAUTHENTICATED");
      return sessionView(
        record.address,
        record.session.walletId,
        record.session.expiresAt,
      );
    },
    async logout(authorization: string | undefined) {
      const token = tokenFromHeader(authorization);
      await this.authenticate(authorization);
      await store.revokeSession(hashSessionValue(token));
    },
  };
}
export type WalletSessionBoundary = ReturnType<typeof createWalletSessions>;
