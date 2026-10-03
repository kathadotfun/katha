import { randomUUID } from "node:crypto";
import type {
  WalletChallengeRecord,
  WalletSessionRecord,
  WalletSessionStore,
} from "@katha/db";
import { expect, it, vi } from "vitest";
import {
  createWalletSessions,
  hashSessionValue,
  CHALLENGE_LIFETIME_MS,
  SESSION_LIFETIME_MS,
} from "../src/wallet-session.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { temporaryWallet } from "./fixtures/wallet.js";

function fixture() {
  const wallet = temporaryWallet();
  const walletId = randomUUID();
  let time = new Date();
  let challenge: WalletChallengeRecord;
  let session: WalletSessionRecord | undefined;
  const store: WalletSessionStore = {
    saveChallenge: vi.fn<WalletSessionStore["saveChallenge"]>(
      async (_address, input) => {
        challenge = {
          ...input,
          id: input.id!,
          issuedAt: input.issuedAt!,
          walletId,
          consumedAt: null,
        };
        return challenge;
      },
    ),
    findChallenge: vi.fn<WalletSessionStore["findChallenge"]>(async (id) =>
      id === challenge?.id ? { address: wallet.address, challenge } : undefined,
    ),
    issueSession: vi.fn<WalletSessionStore["issueSession"]>(
      async (_id, _walletId, tokenHash, expiresAt) => {
        if (challenge.consumedAt || time >= challenge.expiresAt) return undefined;
        challenge.consumedAt = time;
        session = {
          id: randomUUID(),
          walletId,
          challengeId: challenge.id,
          tokenHash,
          expiresAt,
          createdAt: time,
          revokedAt: null,
        };
        return session;
      },
    ),
    findSession: vi.fn<WalletSessionStore["findSession"]>(
      async (tokenHash, domain, cluster) =>
        session &&
        session.tokenHash === tokenHash &&
        !session.revokedAt &&
        session.expiresAt > time &&
        challenge.domain === domain &&
        challenge.cluster === cluster
          ? { session, challenge, address: wallet.address }
          : undefined,
    ),
    revokeSession: vi.fn<WalletSessionStore["revokeSession"]>(async () => {
      if (session) session.revokedAt = time;
    }),
  };
  const config = { origin: "http://localhost:3000", cluster: "localnet" as const };
  const service = createWalletSessions(store, config, () => time);
  return {
    wallet,
    store,
    service,
    config,
    challenge: () => challenge,
    session: () => session,
    advance: (ms: number) => {
      time = new Date(time.getTime() + ms);
    },
  };
}
async function prepared(f: ReturnType<typeof fixture>) {
  const challenge = await f.service.challenge({
    walletAddress: f.wallet.address,
    cluster: "localnet",
  });
  return {
    challengeId: challenge.challengeId,
    walletAddress: f.wallet.address,
    signature: f.wallet.signMessage(challenge.message),
  };
}

it("issues exact-byte signed sessions, stores only token hashes and revokes permanently", async () => {
  const f = fixture();
  const request = await prepared(f);
  const result = await f.service.verify(request);
  expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  expect(f.session()?.tokenHash).toBe(hashSessionValue(result.token));
  expect(JSON.stringify(f.session())).not.toContain(result.token);
  expect(await f.service.authenticate(`Bearer ${result.token}`)).toEqual(
    result.session,
  );
  await f.service.logout(`Bearer ${result.token}`);
  await expect(f.service.authenticate(`Bearer ${result.token}`)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  await expect(f.service.verify(request)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});
it("allows only one issuance in competing verification attempts", async () => {
  const f = fixture();
  const request = await prepared(f);
  const outcomes = await Promise.allSettled([
    f.service.verify(request),
    f.service.verify(request),
  ]);
  expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
});
it.each([
  "wrong-signature",
  "wrong-wallet",
  "message",
  "nonce",
  "domain",
  "cluster",
  "future",
  "expired",
])("rejects %s without issuing a session", async (failure) => {
  const f = fixture();
  const request = await prepared(f);
  switch (failure) {
    case "wrong-signature":
      request.signature = temporaryWallet().signMessage(f.challenge().message);
      break;
    case "wrong-wallet":
      request.walletAddress = temporaryWallet().address;
      break;
    case "message":
      f.challenge().message += "tampered";
      break;
    case "nonce":
      f.challenge().nonce = "0".repeat(64);
      break;
    case "domain":
      f.challenge().domain = "evil.example";
      break;
    case "cluster":
      f.challenge().cluster = "DEVNET";
      break;
    case "future":
      f.advance(-1000);
      break;
    case "expired":
      f.advance(CHALLENGE_LIFETIME_MS);
      break;
  }
  await expect(f.service.verify(request)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(f.store.issueSession).not.toHaveBeenCalled();
});
it("binds session lookup to origin, scheme and cluster and enforces expiry", async () => {
  const f = fixture();
  const result = await f.service.verify(await prepared(f));
  const header = `Bearer ${result.token}`;
  for (const config of [
    { origin: "http://evil.example", cluster: "localnet" },
    { origin: "https://localhost:3000", cluster: "localnet" },
    { origin: f.config.origin, cluster: "devnet" },
  ] as const) {
    await expect(
      createWalletSessions(f.store, config).authenticate(header),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  }
  f.advance(SESSION_LIFETIME_MS);
  await expect(f.service.authenticate(header)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});
it.each([
  undefined,
  "",
  "Bearer private",
  "Basic abc",
  `Bearer ${"a".repeat(64)} extra`,
])("rejects malformed bearer authentication", async (header) => {
  const f = fixture();
  await expect(f.service.authenticate(header)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(f.store.findSession).not.toHaveBeenCalled();
});
it("rejects invalid decoded addresses, wrong cluster and extra verification fields", async () => {
  const f = fixture();
  await expect(
    f.service.challenge({ walletAddress: "z".repeat(44), cluster: "localnet" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    f.service.challenge({ walletAddress: f.wallet.address, cluster: "devnet" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    f.service.verify({ ...(await prepared(f)), message: "injected" }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
it("uses distinct random nonces and signs bounded lifetime and origin fields", async () => {
  const f = fixture();
  const a = await f.service.challenge({
    walletAddress: f.wallet.address,
    cluster: "localnet",
  });
  const first = f.challenge().nonce;
  const b = await f.service.challenge({
    walletAddress: f.wallet.address,
    cluster: "localnet",
  });
  expect(f.challenge().nonce).not.toBe(first);
  expect(a.message).not.toBe(b.message);
  expect(b.message).toContain(`URI: ${f.config.origin}`);
  expect(b.message).toContain("Domain: localhost:3000");
  expect(f.challenge().expiresAt.getTime() - f.challenge().issuedAt.getTime()).toBe(
    CHALLENGE_LIFETIME_MS,
  );
});
it("exposes auth lifecycle with no-store responses and no secret logs", async () => {
  const f = fixture();
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [f.config.origin],
    f.service,
  );
  const challengeResponse = await app.request("/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress: f.wallet.address, cluster: "localnet" }),
  });
  expect(challengeResponse.status).toBe(201);
  const request = {
    challengeId: f.challenge().id,
    walletAddress: f.wallet.address,
    signature: f.wallet.signMessage(f.challenge().message),
  };
  const response = await app.request("/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { token: string };
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(
    (
      await app.request("/auth/session", {
        headers: { Authorization: `Bearer ${result.token}` },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${result.token}` },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await app.request("/auth/session", {
        headers: { Authorization: `Bearer ${result.token}` },
      })
    ).status,
  ).toBe(401);
  for (const value of [
    result.token,
    request.signature,
    f.challenge().nonce,
    f.challenge().message,
  ])
    expect(logs.join("")).not.toContain(value);
});
