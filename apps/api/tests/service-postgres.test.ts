import { randomUUID } from "node:crypto";
import { createArtistStore } from "@katha/db";
import { artistResponseSchema } from "@katha/shared";
import { createArtists } from "../src/artists.js";
import { createAuthorization } from "../src/authorization.js";
import {
  walletChallengeResponseSchema,
  walletSessionResponseSchema,
} from "@katha/shared";
import { createWalletSessionStore } from "@katha/db";
import { createWalletSessions, hashSessionValue } from "../src/wallet-session.js";
import { temporaryWallet } from "./fixtures/wallet.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createDatabase, validateDatabaseUrl } from "@katha/db";
import { expect, it, vi } from "vitest";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createReadiness } from "../src/readiness.js";

it("reports actual PostgreSQL availability then becomes unavailable after pool closure", async () => {
  // Only the owned disposable container runner supplies this target; never load .env.
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable database target");
  const database = createDatabase(url);
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    createReadiness(database.check),
  );
  try {
    const ready = await app.request("/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });
    await database.close();
    expect((await app.request("/health/ready")).status).toBe(503);
    expect((await app.request("/health/live")).status).toBe(200);
    expect(logs.join("")).not.toContain(target.password);
    expect(logs.join("")).not.toContain(url);
  } finally {
    await database.close();
  }
});

it("closes an opened PostgreSQL pool when the running API receives SIGTERM", async () => {
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable database target");
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Expected test port");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: "test",
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
      KATHA_CLUSTER: "localnet",
      DATABASE_URL: url,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  const logs: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("API startup timed out")), 3000);
      child.stdout.on("data", (chunk: Buffer) => {
        const line = chunk.toString();
        logs.push(line);
        if (line.includes(`"port":${port}`)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("API exited before startup"));
      });
    });
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`, {
      signal: AbortSignal.timeout(3000),
    });
    expect(ready.status).toBe(200);
    await ready.text();
    child.kill("SIGTERM");
    expect((await exited)[0]).toBe(0);
    expect(logs.join("")).toContain('"event":"server_stopping"');
    expect(logs.join("")).not.toContain(target.password);
    expect(logs.join("")).not.toContain(url);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
}, 8000);

it("authenticates signed wallets with atomic replay protection and rollback in PostgreSQL", async () => {
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable target");
  const database = createDatabase(url);
  const store = createWalletSessionStore(database.db);
  const config = { origin: "http://localhost:3000", cluster: "localnet" as const };
  const sessions = createWalletSessions(store, config);
  const wallet = temporaryWallet();
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [config.origin],
    sessions,
  );
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const challenge = walletChallengeResponseSchema.parse(
      await (
        await post("/auth/challenge", {
          walletAddress: wallet.address,
          cluster: "localnet",
        })
      ).json(),
    );
    const request = {
      challengeId: challenge.challengeId,
      walletAddress: wallet.address,
      signature: wallet.signMessage(challenge.message),
    };
    const wrong = await post("/auth/verify", {
      ...request,
      signature: temporaryWallet().signMessage(challenge.message),
    });
    expect(wrong.status).toBe(401);
    expect(
      (await store.findChallenge(challenge.challengeId))?.challenge.consumedAt,
    ).toBeNull();
    const outcomes = await Promise.all([
      post("/auth/verify", request),
      post("/auth/verify", request),
    ]);
    expect(outcomes.map((response) => response.status).sort()).toEqual([200, 401]);
    const winner = outcomes.find((response) => response.status === 200)!;
    const result = walletSessionResponseSchema.parse(await winner.json());
    const tokenHash = hashSessionValue(result.token);
    const record = await store.findSession(tokenHash, "localhost:3000", "LOCALNET");
    expect(record?.session.tokenHash).toBe(tokenHash);
    expect(JSON.stringify(record?.session)).not.toContain(result.token);
    expect(
      await store.findSession(tokenHash, "evil.example", "LOCALNET"),
    ).toBeUndefined();
    expect(
      await store.findSession(tokenHash, "localhost:3000", "DEVNET"),
    ).toBeUndefined();
    expect((await post("/auth/verify", request)).status).toBe(401);
    expect(
      (
        await app.request("/auth/session", {
          headers: { Authorization: `Bearer ${result.token}` },
        })
      ).status,
    ).toBe(200);

    const next = await sessions.challenge({
      walletAddress: wallet.address,
      cluster: "localnet",
    });
    const pending = (await store.findChallenge(next.challengeId))!;
    await expect(
      store.issueSession(
        next.challengeId,
        pending.challenge.walletId,
        tokenHash,
        new Date(Date.now() + 60_000),
      ),
    ).rejects.toBeDefined();
    expect(
      (await store.findChallenge(next.challengeId))?.challenge.consumedAt,
    ).toBeNull();
    const retry = await sessions.verify({
      challengeId: next.challengeId,
      walletAddress: wallet.address,
      signature: wallet.signMessage(next.message),
    });
    expect(retry.token).not.toBe(result.token);

    for (const offset of [-10 * 60_000, 10 * 60_000]) {
      const skewed = createWalletSessions(
        store,
        config,
        () => new Date(Date.now() + offset),
      );
      const invalid = await skewed.challenge({
        walletAddress: wallet.address,
        cluster: "localnet",
      });
      await expect(
        skewed.verify({
          challengeId: invalid.challengeId,
          walletAddress: wallet.address,
          signature: wallet.signMessage(invalid.message),
        }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(
        (await store.findChallenge(invalid.challengeId))?.challenge.consumedAt,
      ).toBeNull();
    }
    await sessions.logout(`Bearer ${result.token}`);
    await expect(sessions.authenticate(`Bearer ${result.token}`)).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" },
    );
    for (const value of [result.token, request.signature, challenge.message])
      expect(logs.join("")).not.toContain(value);
  } finally {
    await database.close();
  }
}, 10_000);

it("creates and manually verifies artists through real signed sessions with race-safe PostgreSQL writes", async () => {
  const url = validateDatabaseUrl(process.env.KATHA_TEST_DATABASE_URL);
  const target = new URL(url);
  if (target.hostname !== "127.0.0.1" || target.pathname !== "/katha_test")
    throw new Error("Expected disposable target");
  const database = createDatabase(url);
  const admin = temporaryWallet();
  const verifierA = temporaryWallet();
  const verifierB = temporaryWallet();
  const outsider = temporaryWallet();
  const config = { origin: "http://localhost:3000", cluster: "localnet" as const };
  const sessions = createWalletSessions(createWalletSessionStore(database.db), config);
  const chainRead = vi.fn(async () => {
    throw new Error("Artist profile approval is off-chain");
  });
  const authorization = createAuthorization(
    sessions,
    {
      cluster: "localnet",
      adminWallets: [admin.address],
      verifierWallets: [verifierA.address, verifierB.address],
    },
    chainRead,
  );
  const store = createArtistStore(database.db);
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [config.origin],
    sessions,
    authorization,
    createArtists(store),
  );
  const post = (path: string, body: unknown, token?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  async function login(wallet: ReturnType<typeof temporaryWallet>) {
    const challenge = walletChallengeResponseSchema.parse(
      await (
        await post("/auth/challenge", {
          walletAddress: wallet.address,
          cluster: "localnet",
        })
      ).json(),
    );
    const verified = await post("/auth/verify", {
      challengeId: challenge.challengeId,
      walletAddress: wallet.address,
      signature: wallet.signMessage(challenge.message),
    });
    expect(verified.status).toBe(200);
    return walletSessionResponseSchema.parse(await verified.json()).token;
  }
  try {
    const adminToken = await login(admin);
    const verifierTokenA = await login(verifierA);
    const verifierTokenB = await login(verifierB);
    const outsiderToken = await login(outsider);
    const profile = {
      slug: `synthetic-api-${randomUUID()}`,
      displayName: "Fictional test artist",
      biography: "Synthetic biography, approved public content.",
      region: "Patan",
      traditions: ["Paubha"],
      publicLinks: ["https://example.com/fictional-artist"],
    };
    expect((await post("/admin/artists", profile)).status).toBe(401);
    expect((await post("/admin/artists", profile, outsiderToken)).status).toBe(403);
    expect((await post("/admin/artists", profile, verifierTokenA)).status).toBe(403);
    expect(
      await database.db.query.artists.findFirst({
        where: (row, { eq }) => eq(row.slug, profile.slug),
      }),
    ).toBeUndefined();
    expect(
      (
        await post(
          "/admin/artists",
          { ...profile, verificationStatus: "VERIFIED" },
          adminToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/admin/artists",
          { ...profile, payoutWallet: "z".repeat(44) },
          adminToken,
        )
      ).status,
    ).toBe(400);

    const creationRace = await Promise.all([
      post("/admin/artists", profile, adminToken),
      post("/admin/artists", profile, adminToken),
    ]);
    expect(creationRace.map((result) => result.status).sort()).toEqual([201, 409]);
    const created = artistResponseSchema.parse(
      await creationRace.find((result) => result.status === 201)!.json(),
    );
    expect(created.creatorWallet).toBeNull();
    expect(created.payoutWallet).toBeNull();
    expect(created.verificationStatus).toBe("UNVERIFIED");
    const path = `/verifier/artists/${created.id}/verification`;
    for (const token of [adminToken, outsiderToken])
      expect((await post(path, { confirmed: true }, token)).status).toBe(403);
    expect(
      (
        await post(
          path,
          { confirmed: true, verifiedByWallet: admin.address },
          verifierTokenA,
        )
      ).status,
    ).toBe(400);
    const unchanged = await database.db.query.artists.findFirst({
      where: (row, { eq }) => eq(row.id, created.id),
    });
    expect(unchanged?.verificationStatus).toBe("UNVERIFIED");
    expect(unchanged?.verifiedByWallet).toBeNull();
    expect(unchanged?.verifiedAt).toBeNull();

    const approvals = await Promise.all([
      post(path, { confirmed: true }, verifierTokenA),
      post(path, { confirmed: true }, verifierTokenB),
    ]);
    expect(approvals.map((result) => result.status).sort()).toEqual([200, 409]);
    const approved = artistResponseSchema.parse(
      await approvals.find((result) => result.status === 200)!.json(),
    );
    expect([verifierA.address, verifierB.address]).toContain(approved.verifiedByWallet);
    expect(approved.verifiedAt).not.toBeNull();
    expect(Date.parse(approved.verifiedAt!)).toBeGreaterThanOrEqual(
      Date.parse(created.createdAt),
    );
    expect(approved.verifiedAt).toBe(approved.updatedAt);
    expect(approved.id).toBe(created.id);
    expect(approved.createdAt).toBe(created.createdAt);
    expect(approved.biography).toBe(created.biography);
    expect((await post(path, { confirmed: true }, verifierTokenB)).status).toBe(409);
    const stored = await database.db.query.artists.findFirst({
      where: (row, { eq }) => eq(row.id, created.id),
    });
    expect(stored?.verifiedByWallet).toBe(approved.verifiedByWallet);
    expect(stored?.verifiedAt?.toISOString()).toBe(approved.verifiedAt);
    expect(
      (
        await post(
          `/verifier/artists/${randomUUID()}/verification`,
          { confirmed: true },
          verifierTokenA,
        )
      ).status,
    ).toBe(404);
    const payoutOnly = await post(
      "/admin/artists",
      {
        ...profile,
        slug: `synthetic-payout-${randomUUID()}`,
        payoutWallet: admin.address,
      },
      adminToken,
    );
    expect(payoutOnly.status).toBe(201);
    expect(artistResponseSchema.parse(await payoutOnly.json())).toMatchObject({
      creatorWallet: null,
      payoutWallet: admin.address,
      verificationStatus: "UNVERIFIED",
    });
    await sessions.logout(`Bearer ${adminToken}`);
    expect(
      (
        await post(
          "/admin/artists",
          { ...profile, slug: `synthetic-revoked-${randomUUID()}` },
          adminToken,
        )
      ).status,
    ).toBe(401);
    expect(chainRead).not.toHaveBeenCalled();
    for (const value of [
      adminToken,
      verifierTokenA,
      verifierTokenB,
      outsiderToken,
      profile.biography,
    ])
      expect(logs.join("")).not.toContain(value);
  } finally {
    await database.close();
  }
}, 10000);
