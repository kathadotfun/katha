import { expect, it } from "vitest";
import {
  walletPermissionsSchema,
  walletChallengeRequestSchema,
  walletVerifyRequestSchema,
  walletSessionResponseSchema,
} from "../src/index.js";

it("rejects unknown fields and unsupported clusters in challenge requests", () => {
  const value = { walletAddress: "1".repeat(32), cluster: "devnet" };
  expect(walletChallengeRequestSchema.parse(value)).toEqual(value);
  expect(
    walletChallengeRequestSchema.safeParse({ ...value, cluster: "mainnet-beta" })
      .success,
  ).toBe(false);
  expect(
    walletChallengeRequestSchema.safeParse({ ...value, domain: "evil.example" })
      .success,
  ).toBe(false);
});
it.each(["base64url_signature", "A".repeat(86), "A".repeat(87) + "="])(
  "rejects invalid signature transport %s",
  (signature) => {
    expect(
      walletVerifyRequestSchema.safeParse({
        challengeId: "b55d5929-a53d-4608-82d1-f6d91c1ba563",
        walletAddress: "1".repeat(32),
        signature,
      }).success,
    ).toBe(false);
  },
);
it("keeps session responses strict and does not expose persistent token hashes or roles", () => {
  const value = {
    token: "a".repeat(64),
    session: {
      walletId: "b55d5929-a53d-4608-82d1-f6d91c1ba563",
      walletAddress: "1".repeat(32),
      cluster: "devnet",
      expiresAt: "2026-10-05T00:00:00.000Z",
    },
  };
  expect(walletSessionResponseSchema.parse(value)).toEqual(value);
  expect(
    walletSessionResponseSchema.safeParse({ ...value, tokenHash: "private" }).success,
  ).toBe(false);
  expect(
    walletSessionResponseSchema.safeParse({
      ...value,
      session: { ...value.session, role: "admin" },
    }).success,
  ).toBe(false);
});

it("permission discovery strictly describes one authenticated wallet and independent roles", () => {
  const session = {
    walletId: "aaaaaaaa-1111-4111-8111-111111111111",
    walletAddress: "1".repeat(32),
    cluster: "localnet",
    expiresAt: "2026-10-06T00:00:00Z",
  };
  for (const admin of [false, true])
    for (const verifier of [false, true])
      expect(walletPermissionsSchema.parse({ session, admin, verifier })).toEqual({
        session,
        admin,
        verifier,
      });
  expect(
    walletPermissionsSchema.safeParse({ session, admin: "true", verifier: false })
      .success,
  ).toBe(false);
  expect(
    walletPermissionsSchema.safeParse({
      session,
      admin: true,
      verifier: false,
      adminWallets: [],
    }).success,
  ).toBe(false);
  expect(
    walletPermissionsSchema.safeParse({
      session: { ...session, token: "private" },
      admin: true,
      verifier: false,
    }).success,
  ).toBe(false);
});
