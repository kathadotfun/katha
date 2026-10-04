import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { ArtworkDraftStore, ArtworkRecord } from "@katha/db";
import { artworkDraftResponseSchema, type WalletSession } from "@katha/shared";
import { createApi } from "../src/app.js";
import { createArtworkDrafts } from "../src/artwork-drafts.js";
import { createAuthorization } from "../src/authorization.js";
import { createLogger } from "../src/logger.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";
const input = {
  creationRequestId: randomUUID(),
  artistId: randomUUID(),
  category: "PAUBHA",
  title: "Synthetic artwork",
  creationYear: 2026,
};
function fixture() {
  const now = new Date();
  const record: ArtworkRecord = {
    ...input,
    category: "PAUBHA",
    id: randomUUID(),
    kathaId: "KATHA-PAUBHA-000001",
    creatorWallet: null,
    authorshipEvidenceHash: null,
    heightMm: null,
    widthMm: null,
    depthMm: null,
    originCountryCode: "NP",
    originRegion: null,
    originLocality: null,
    technique: null,
    story: null,
    meaning: null,
    culturalContext: null,
    creationProcess: null,
    createdAt: now,
    updatedAt: now,
  };
  Object.assign(record, {
    privateEvidence: "PRIVATE-EVIDENCE",
    payoutWallet: "PRIVATE-PAYOUT",
  });
  const store: ArtworkDraftStore = {
    create: vi.fn<ArtworkDraftStore["create"]>(async () => ({
      status: "created",
      record,
    })),
  };
  const admin = temporaryWallet().address;
  const verifier = temporaryWallet().address;
  const session: WalletSession = {
    walletId: randomUUID(),
    walletAddress: admin,
    cluster: "localnet",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const chain = vi.fn(async () => {
    throw new Error("No chain calls for drafts");
  });
  const authorization = createAuthorization(
    {
      authenticate: async (header) => {
        if (header === "Bearer admin") return session;
        if (header === "Bearer verifier")
          return { ...session, walletAddress: verifier };
        if (header === "Bearer outsider")
          return { ...session, walletAddress: temporaryWallet().address };
        throw new DomainError("UNAUTHENTICATED");
      },
    },
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
    undefined,
    undefined,
    createArtworkDrafts(store),
  );
  const post = (body: unknown, token?: string) =>
    app.request("/admin/artworks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { app, store, record, post, logs, chain };
}
it("creates a private draft with server identity and nullable content", async () => {
  const f = fixture();
  const response = await f.post(input, "admin");
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const result = artworkDraftResponseSchema.parse(await response.json());
  expect(result).toMatchObject({
    id: f.record.id,
    kathaId: f.record.kathaId,
    creatorWallet: null,
    dimensions: null,
    origin: { countryCode: "NP", region: null, locality: null },
  });
  expect(result).not.toHaveProperty("creationRequestId");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(f.chain).not.toHaveBeenCalled();
  expect(f.logs.join("")).not.toContain(input.title);
});
it.each([undefined, "verifier", "outsider"])(
  "denies %s before storage",
  async (token) => {
    const f = fixture();
    expect((await f.post(input, token)).status).toBe(token ? 403 : 401);
    expect(f.store.create).not.toHaveBeenCalled();
  },
);
it.each([
  { artistId: "invalid" },
  { creationRequestId: "invalid" },
  { category: "NFT" },
  { title: " " },
  { title: "bad\u0000title" },
  { creationYear: "2026" },
  { dimensions: { heightMm: 10 } },
  { dimensions: { heightMm: 10, widthMm: 2147483648 } },
  { origin: { countryCode: "np" } },
  { story: " " },
  { authorshipEvidenceHash: "invalid" },
  { id: randomUUID() },
  { kathaId: "KATHA-PAUBHA-000002" },
  { creatorWallet: temporaryWallet().address },
  { verificationStatus: "VERIFIED" },
  { privateEvidence: "secret" },
  { materials: ["gold"] },
])("rejects malformed or privileged creation %j", async (invalid) => {
  const f = fixture();
  expect((await f.post({ ...input, ...invalid }, "admin")).status).toBe(400);
  expect(f.store.create).not.toHaveBeenCalled();
});
it("normalizes full draft content without accepting identity overrides", async () => {
  const f = fixture();
  const body = {
    ...input,
    artistId: input.artistId.toUpperCase(),
    dimensions: { heightMm: 300, widthMm: 200 },
    origin: { countryCode: "NP", region: "Patan" },
    story: "Synthetic story",
    authorshipEvidenceHash: "a".repeat(64),
  };
  expect((await f.post(body, "admin")).status).toBe(201);
  expect(f.store.create).toHaveBeenCalledWith(
    expect.objectContaining({
      artistId: input.artistId,
      heightMm: 300,
      widthMm: 200,
      depthMm: null,
      originLocality: null,
      story: body.story,
      authorshipEvidenceHash: body.authorshipEvidenceHash,
    }),
  );
});
it.each([
  ["artist_not_found", 404],
  ["duplicate", 409],
  ["capacity_exhausted", 409],
] as const)("maps %s to %s", async (status, expected) => {
  const f = fixture();
  vi.mocked(f.store.create).mockResolvedValue({ status });
  expect((await f.post(input, "admin")).status).toBe(expected);
});
it("redacts unexpected database errors", async () => {
  const f = fixture();
  vi.mocked(f.store.create).mockRejectedValue(new Error("PRIVATE-DATABASE-URL"));
  const response = await f.post(input, "admin");
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(f.logs.join("")).not.toContain("PRIVATE");
});
it("denies the real draft route when authorization wiring is missing", async () => {
  const f = fixture();
  const app = createApi(
    createLogger(() => {}),
    undefined,
    [],
    undefined,
    undefined,
    undefined,
    undefined,
    createArtworkDrafts(f.store),
  );
  expect(
    (
      await app.request("/admin/artworks", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).status,
  ).toBe(401);
  expect(f.store.create).not.toHaveBeenCalled();
});
