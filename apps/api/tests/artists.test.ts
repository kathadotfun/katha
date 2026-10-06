import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ArtistRecord, ArtistStore } from "@katha/db";
import { artistResponseSchema, type WalletSession } from "@katha/shared";
import { createArtists } from "../src/artists.js";
import { createAuthorization } from "../src/authorization.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";
const profile = {
  slug: "synthetic-artist",
  displayName: "Fictional artist",
  biography: "Synthetic artist documentation",
  region: "Patan",
  traditions: ["Paubha"],
};
function fixture() {
  const admin = temporaryWallet().address;
  const verifier = temporaryWallet().address;
  const stranger = temporaryWallet().address;
  const now = new Date();
  const record: ArtistRecord = {
    ...profile,
    id: randomUUID(),
    publicLinks: [],
    creatorWallet: null,
    payoutWallet: null,
    profileImageUrl: null,
    verificationStatus: "UNVERIFIED",
    verifiedByWallet: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(record, { privateEvidence: "SYNTHETIC_PRIVATE_EVIDENCE" });
  const store: ArtistStore = {
    read: vi.fn<ArtistStore["read"]>(async () => record),
    create: vi.fn<ArtistStore["create"]>(async () => record),
    verify: vi.fn<ArtistStore["verify"]>(async (_id, wallet) => ({
      status: "verified",
      record: {
        ...record,
        verificationStatus: "VERIFIED",
        verifiedByWallet: wallet,
        verifiedAt: now,
      },
    })),
  };
  const session: WalletSession = {
    walletId: randomUUID(),
    walletAddress: verifier,
    cluster: "localnet",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const authenticate = vi.fn(async (header: string | undefined) => {
    if (header === "Bearer admin") return { ...session, walletAddress: admin };
    if (header === "Bearer verifier") return session;
    if (header === "Bearer stranger") return { ...session, walletAddress: stranger };
    throw new DomainError("UNAUTHENTICATED");
  });
  const chain = vi.fn(async () => {
    throw new Error("Chain should not be used for artist profiles");
  });
  const authorization = createAuthorization(
    { authenticate },
    { cluster: "localnet", adminWallets: [admin], verifierWallets: [verifier] },
    chain,
  );
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
    undefined,
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
  return { record, store, session, app, post, chain, logs };
}
it("creates unverified profiles with server identity and approves with authenticated verifier attribution", async () => {
  const f = fixture();
  const created = await f.post("/admin/artists", profile, "admin");
  expect(created.status).toBe(201);
  const result = artistResponseSchema.parse(await created.json());
  expect(result.verificationStatus).toBe("UNVERIFIED");
  expect(result.creatorWallet).toBeNull();
  expect(result.payoutWallet).toBeNull();
  const verified = await f.post(
    `/verifier/artists/${result.id}/verification`,
    { confirmed: true },
    "verifier",
  );
  expect(verified.status).toBe(200);
  const approval = artistResponseSchema.parse(await verified.json());
  expect(approval.verifiedByWallet).toBe(f.session.walletAddress);
  expect(f.store.verify).toHaveBeenCalledWith(result.id, f.session.walletAddress);
  expect(f.chain).not.toHaveBeenCalled();
  expect(JSON.stringify(approval)).not.toContain("SYNTHETIC_PRIVATE_EVIDENCE");
  expect(f.logs.join("")).not.toContain(profile.biography);
  expect(f.logs.join("")).not.toContain("Bearer");
});
it.each([undefined, "stranger", "verifier"])(
  "denies creation by %s before persistence",
  async (token) => {
    const f = fixture();
    expect((await f.post("/admin/artists", profile, token)).status).toBe(
      token ? 403 : 401,
    );
    expect(f.store.create).not.toHaveBeenCalled();
  },
);
it.each([undefined, "stranger", "admin"])(
  "denies verification by %s before persistence",
  async (token) => {
    const f = fixture();
    expect(
      (
        await f.post(
          `/verifier/artists/${f.record.id}/verification`,
          { confirmed: true },
          token,
        )
      ).status,
    ).toBe(token ? 403 : 401);
    expect(f.store.verify).not.toHaveBeenCalled();
  },
);
it.each([
  { biography: " " },
  { publicLinks: ["not-a-url"] },
  { creatorWallet: "z".repeat(44) },
  { payoutWallet: "11111111111111111111111111111111" },
  { verificationStatus: "VERIFIED" },
  { id: randomUUID() },
  { privateEvidence: "SYNTHETIC_SECRET" },
])("rejects invalid creation without writing %j", async (invalid) => {
  const f = fixture();
  expect(
    (await f.post("/admin/artists", { ...profile, ...invalid }, "admin")).status,
  ).toBe(400);
  expect(f.store.create).not.toHaveBeenCalled();
});
it("maps duplicate slugs, unknown IDs and repeated approvals to safe domain errors", async () => {
  const f = fixture();
  vi.mocked(f.store.create).mockResolvedValueOnce(undefined);
  expect((await f.post("/admin/artists", profile, "admin")).status).toBe(409);
  vi.mocked(f.store.verify).mockResolvedValueOnce({ status: "not_found" });
  expect(
    (
      await f.post(
        `/verifier/artists/${randomUUID()}/verification`,
        { confirmed: true },
        "verifier",
      )
    ).status,
  ).toBe(404);
  vi.mocked(f.store.verify).mockResolvedValueOnce({ status: "already_verified" });
  expect(
    (
      await f.post(
        `/verifier/artists/${f.record.id}/verification`,
        { confirmed: true },
        "verifier",
      )
    ).status,
  ).toBe(409);
});
it("rejects malformed IDs and forged verifier/time input", async () => {
  const f = fixture();
  expect(
    (
      await f.post(
        "/verifier/artists/bad/verification",
        { confirmed: true },
        "verifier",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.post(
        `/verifier/artists/${f.record.id}/verification`,
        { confirmed: true, verifiedByWallet: f.session.walletAddress },
        "verifier",
      )
    ).status,
  ).toBe(400);
  expect(f.store.verify).not.toHaveBeenCalled();
});
it("redacts unexpected database errors and guards real endpoints when wiring is missing", async () => {
  const f = fixture();
  vi.mocked(f.store.create).mockRejectedValueOnce(
    new Error("SYNTHETIC_DATABASE_SECRET"),
  );
  const response = await f.post("/admin/artists", profile, "admin");
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("SYNTHETIC_DATABASE_SECRET");
  expect(f.logs.join("")).not.toContain("SYNTHETIC_DATABASE_SECRET");
  const unguarded = createApi(
    createLogger(() => {}),
    undefined,
    [],
    undefined,
    undefined,
    createArtists(f.store),
  );
  expect(
    (
      await unguarded.request("/admin/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      })
    ).status,
  ).toBe(401);
});

it("protects unverified profile review and omits private fields", async () => {
  const f = fixture();
  for (const [token, status] of [
    [undefined, 401],
    ["admin", 403],
    ["stranger", 403],
    ["verifier", 200],
  ] as const) {
    const res = await f.app.request(`/verifier/artists/${f.record.id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(res.status).toBe(status);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).not.toContain("SYNTHETIC_PRIVATE_EVIDENCE");
  }
  expect(f.store.read).toHaveBeenCalledTimes(1);
  vi.mocked(f.store.read).mockResolvedValueOnce(undefined);
  expect(
    (
      await f.app.request(`/verifier/artists/${f.record.id}`, {
        headers: { Authorization: "Bearer verifier" },
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await f.app.request("/verifier/artists/wrong", {
        headers: { Authorization: "Bearer verifier" },
      })
    ).status,
  ).toBe(400);
});
