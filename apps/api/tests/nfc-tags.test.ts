import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { NfcTagStore, NfcTagRecord } from "@katha/db";
import { nfcTagListResponseSchema, type WalletSession } from "@katha/shared";
import { createApi } from "../src/app.js";
import { createNfcTags } from "../src/nfc-tags.js";
import { createAuthorization } from "../src/authorization.js";
import { createLogger } from "../src/logger.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";

function fixture() {
  const record: NfcTagRecord = {
    tagId: randomUUID(),
    artworkId: randomUUID(),
    kathaId: "KATHA-PAUBHA-000001",
    assignedByWalletId: randomUUID(),
    assignedAt: new Date("2026-10-06T00:00:00Z"),
    retiredAt: null,
    retiredByWalletId: null,
  };
  Object.assign(record, { privateEvidence: "PRIVATE_SENTINEL" });
  const retired = {
    ...record,
    retiredAt: new Date("2026-10-06T01:00:00Z"),
    retiredByWalletId: record.assignedByWalletId,
  };
  const store: NfcTagStore = {
    assign: vi.fn<NfcTagStore["assign"]>(async () => ({ status: "assigned", record })),
    get: vi.fn<NfcTagStore["get"]>(async () => record),
    listByArtwork: vi.fn<NfcTagStore["listByArtwork"]>(async () => [
      { ...retired, tagId: randomUUID() },
      record,
    ]),
    retire: vi.fn<NfcTagStore["retire"]>(async () => retired),
  };
  const admin = temporaryWallet().address;
  const verifier = temporaryWallet().address;
  const session: WalletSession = {
    walletId: record.assignedByWalletId,
    walletAddress: admin,
    cluster: "localnet",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const authorization = createAuthorization(
    {
      authenticate: async (header) => {
        if (header === "Bearer admin") return session;
        if (header === "Bearer verifier")
          return { ...session, walletAddress: verifier };
        if (header === "Bearer outsider")
          return { ...session, walletAddress: temporaryWallet().address };
        if (header === "Bearer wrong-cluster") return { ...session, cluster: "devnet" };
        throw new DomainError("UNAUTHENTICATED");
      },
    },
    { cluster: "localnet", adminWallets: [admin], verifierWallets: [verifier] },
    async () => ({
      authority: admin,
      registrationAuthority: admin,
      custodyAuthority: admin,
      verifierAuthority: verifier,
    }),
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createNfcTags(store),
  );
  const request = (path: string, method: string, body: unknown = {}, token = "admin") =>
    app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    });
  return {
    store,
    record,
    retired,
    session,
    request,
    logs,
    assignPath: `/admin/artworks/${record.kathaId}/nfc-tags`,
    tagPath: `/admin/nfc-tags/${record.tagId}`,
  };
}
it("admin assigns, reads and retires tags without leaking audit or private fields", async () => {
  const f = fixture();
  const assigned = await f.request(f.assignPath, "POST", { tagId: f.record.tagId });
  expect(assigned.status).toBe(200);
  expect(assigned.headers.get("Cache-Control")).toBe("no-store");
  const value = await assigned.json();
  expect(value).toEqual({
    tagId: f.record.tagId,
    kathaId: f.record.kathaId,
    state: "ACTIVE",
    assignedAt: f.record.assignedAt.toISOString(),
    retiredAt: null,
  });
  expect(f.store.assign).toHaveBeenCalledWith(
    f.record.kathaId,
    f.record.tagId,
    f.session.walletId,
  );
  expect((await f.request(f.tagPath, "GET")).status).toBe(200);
  const retired = await f.request(f.tagPath + "/retire", "POST");
  expect(retired.status).toBe(200);
  expect(await retired.json()).toMatchObject({
    state: "RETIRED",
    retiredAt: f.retired.retiredAt.toISOString(),
  });
  expect(f.store.retire).toHaveBeenCalledWith(f.record.tagId, f.session.walletId);
  expect(f.logs.join("\n")).not.toContain(f.record.tagId);
  expect(f.logs.join("\n")).not.toContain("PRIVATE_SENTINEL");
});
it("all NFC admin routes deny anonymous, verifier-only, outsider and wrong-cluster sessions before storage", async () => {
  const f = fixture();
  for (const token of ["", "verifier", "outsider", "wrong-cluster"])
    for (const [path, method, body] of [
      [f.assignPath, "POST", { tagId: f.record.tagId }],
      [f.tagPath, "GET", {}],
      [f.assignPath, "GET", {}],
      [f.tagPath + "/retire", "POST", {}],
    ] as const)
      expect((await f.request(path, method, body, token)).status).toBe(
        token ? 403 : 401,
      );
  expect(f.store.assign).not.toHaveBeenCalled();
  expect(f.store.get).not.toHaveBeenCalled();
  expect(f.store.listByArtwork).not.toHaveBeenCalled();
  expect(f.store.retire).not.toHaveBeenCalled();
});
it("admin lists every binding for one artwork without audit fields", async () => {
  const f = fixture();
  const listed = await f.request(f.assignPath, "GET");
  expect(listed.status).toBe(200);
  expect(listed.headers.get("Cache-Control")).toBe("no-store");
  const body = nfcTagListResponseSchema.parse(await listed.json());
  expect(body.kathaId).toBe(f.record.kathaId);
  expect(body.items.map((item) => item.state)).toEqual(["RETIRED", "ACTIVE"]);
  const text = JSON.stringify(body);
  expect(text).not.toContain("PRIVATE_SENTINEL");
  expect(text).not.toContain(f.record.assignedByWalletId);
  expect(f.store.listByArtwork).toHaveBeenCalledWith(f.record.kathaId);
  vi.mocked(f.store.listByArtwork).mockResolvedValueOnce(null);
  expect((await f.request(f.assignPath, "GET")).status).toBe(404);
  // A binding that names a different artwork is a corrupt read, never shown.
  vi.mocked(f.store.listByArtwork).mockResolvedValueOnce([
    { ...f.record, kathaId: "KATHA-PAUBHA-000002" },
  ]);
  expect((await f.request(f.assignPath, "GET")).status).toBe(500);
  expect((await f.request("/admin/artworks/invalid/nfc-tags", "GET")).status).toBe(400);
});
it("invalid IDs and extra body fields fail validation before any store call", async () => {
  const f = fixture();
  for (const body of [
    {},
    { tagId: "04aabbccdd" },
    { tagId: f.record.tagId, redirectUrl: "https://example.com" },
    { tagId: f.record.tagId, assignedByWalletId: randomUUID() },
  ])
    expect((await f.request(f.assignPath, "POST", body)).status).toBe(400);
  expect(
    (
      await f.request("/admin/artworks/invalid/nfc-tags", "POST", {
        tagId: f.record.tagId,
      })
    ).status,
  ).toBe(400);
  expect((await f.request("/admin/nfc-tags/invalid", "GET")).status).toBe(400);
  expect(
    (await f.request(f.tagPath + "/retire", "POST", { retiredAt: "2026-01-01" }))
      .status,
  ).toBe(400);
  expect(f.store.assign).not.toHaveBeenCalled();
  expect(f.store.get).not.toHaveBeenCalled();
  expect(f.store.retire).not.toHaveBeenCalled();
});
it("missing records, duplicate bindings and unexpected storage errors remain safe", async () => {
  const f = fixture();
  for (const [status, http] of [
    ["not_found", 404],
    ["conflict", 409],
  ] as const) {
    vi.mocked(f.store.assign).mockResolvedValueOnce({ status });
    expect(
      (await f.request(f.assignPath, "POST", { tagId: f.record.tagId })).status,
    ).toBe(http);
  }
  vi.mocked(f.store.get).mockResolvedValueOnce(null);
  expect((await f.request(f.tagPath, "GET")).status).toBe(404);
  vi.mocked(f.store.retire).mockResolvedValueOnce(null);
  expect((await f.request(f.tagPath + "/retire", "POST")).status).toBe(404);
  vi.mocked(f.store.assign).mockRejectedValueOnce(
    new Error("PRIVATE_DATABASE_PASSWORD"),
  );
  const error = await f.request(f.assignPath, "POST", { tagId: f.record.tagId });
  expect(error.status).toBe(500);
  expect(await error.text()).not.toContain("PRIVATE");
  expect(f.logs.join("\n")).not.toContain("PRIVATE");
});
it("NFC endpoints are absent from public and verifier namespaces", async () => {
  const f = fixture();
  expect((await f.request(`/nfc-tags/${f.record.tagId}`, "GET")).status).toBe(404);
  expect(
    (await f.request(`/verifier/nfc-tags/${f.record.tagId}`, "GET", {}, "verifier"))
      .status,
  ).toBe(404);
  expect(f.store.get).not.toHaveBeenCalled();
});
