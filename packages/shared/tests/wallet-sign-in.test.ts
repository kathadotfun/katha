import { describe, expect, it } from "vitest";
import {
  walletSignInMessage,
  validateWalletSignInChallenge,
} from "../src/wallet-session.js";
const origin = "http://localhost:3000";
const context = {
  origin,
  walletAddress: "11111111111111111111111111111111",
  cluster: "localnet" as const,
};
const now = Date.parse("2026-10-06T00:00:00.000Z");
const fields = {
  ...context,
  nonce: "a".repeat(64),
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 300_000).toISOString(),
  challengeId: "aaaaaaaa-1111-4111-8111-111111111111",
};
const challenge = {
  challengeId: fields.challengeId,
  expiresAt: fields.expiresAt,
  message: walletSignInMessage(fields),
};
describe("canonical browser sign-in challenge", () => {
  it("accepts exact canonical bytes and matching context", () => {
    expect(challenge.message).toBe(
      [
        "Katha wallet sign-in",
        "Sign this message to authenticate. This does not authorize a transaction.",
        "Domain: localhost:3000",
        "URI: http://localhost:3000",
        "Wallet: 11111111111111111111111111111111",
        "Cluster: localnet",
        `Nonce: ${"a".repeat(64)}`,
        "Issued At: 2026-10-06T00:00:00.000Z",
        "Expiration Time: 2026-10-06T00:05:00.000Z",
        "Challenge ID: aaaaaaaa-1111-4111-8111-111111111111",
      ].join("\n"),
    );
    expect(validateWalletSignInChallenge(challenge, context, now)).toEqual(challenge);
  });
  it.each([
    [
      "domain",
      challenge.message.replace("Domain: localhost:3000", "Domain: attacker.test"),
    ],
    ["URI", challenge.message.replace(origin, "http://attacker.test")],
    [
      "wallet",
      challenge.message.replace(
        context.walletAddress,
        "11111111111111111111111111111112",
      ),
    ],
    ["cluster", challenge.message.replace("Cluster: localnet", "Cluster: devnet")],
    ["nonce", challenge.message.replace(fields.nonce, "unsafe")],
    [
      "ID",
      challenge.message.replace(
        fields.challengeId,
        "bbbbbbbb-1111-4111-8111-111111111111",
      ),
    ],
    ["newline", challenge.message + "\n"],
    [
      "expiry",
      challenge.message.replace(fields.expiresAt, new Date(now + 1).toISOString()),
    ],
  ])("rejects changed %s before signing", (_, message) => {
    expect(() =>
      validateWalletSignInChallenge({ ...challenge, message }, context, now),
    ).toThrow();
  });
  it("rejects expired/future/overlong lifetime and extra response fields", () => {
    expect(() =>
      validateWalletSignInChallenge(challenge, context, now + 300_000),
    ).toThrow();
    expect(() => validateWalletSignInChallenge(challenge, context, now - 1)).toThrow();
    const expiresAt = new Date(now + 300_001).toISOString();
    expect(() =>
      validateWalletSignInChallenge(
        {
          ...challenge,
          expiresAt,
          message: walletSignInMessage({ ...fields, expiresAt }),
        },
        context,
        now,
      ),
    ).toThrow();
    expect(() =>
      validateWalletSignInChallenge({ ...challenge, secret: true }, context, now),
    ).toThrow();
  });
});
