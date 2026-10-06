import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { NfcResolutionStore } from "@katha/db";
import { apiErrorResponseSchema } from "@katha/shared";
import { createApi } from "../src/app.js";
import { createNfcResolution } from "../src/nfc-resolution.js";
import { createLogger } from "../src/logger.js";

function fixture(origin = "https://katha.fun") {
  const record = {
    tagId: randomUUID(),
    kathaId: "KATHA-PAUBHA-000001",
    retiredAt: null as Date | null,
  };
  const store: NfcResolutionStore = {
    find: vi.fn<NfcResolutionStore["find"]>(async () => record),
  };
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [],
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
    undefined,
    undefined,
    undefined,
    createNfcResolution(store, origin),
  );
  return { app, store, record, logs, path: `/nfc/${record.tagId}` };
}
it.each(["https://katha.fun", "http://localhost:3000", "http://192.168.1.87:3000"])(
  "redirects anonymously to the fixed permanent artwork path on %s",
  async (origin) => {
    const f = fixture(origin);
    Object.assign(f.record, {
      redirectUrl: "https://evil.example",
      privateEvidence: "PRIVATE_SENTINEL",
    });
    const result = await f.app.request(f.path, {
      headers: {
        Host: "evil.example",
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "https",
      },
    });
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe(`${origin}/art/${f.record.kathaId}`);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(f.store.find).toHaveBeenCalledWith(f.record.tagId);
    expect(await result.text()).not.toContain("PRIVATE");
    expect(f.logs.join("\n")).not.toContain(f.record.tagId);
    expect(f.logs.join("\n")).not.toContain("PRIVATE");
  },
);
it("returns explicit missing and retired errors without redirects or binding disclosure", async () => {
  const f = fixture();
  vi.mocked(f.store.find).mockResolvedValueOnce(null);
  const missing = await f.app.request(f.path);
  expect(missing.status).toBe(404);
  expect(apiErrorResponseSchema.parse(await missing.json()).error.code).toBe(
    "NOT_FOUND",
  );
  f.record.retiredAt = new Date();
  const retired = await f.app.request(f.path);
  expect(retired.status).toBe(410);
  const body = await retired.text();
  expect(apiErrorResponseSchema.parse(JSON.parse(body)).error.code).toBe(
    "NFC_TAG_RETIRED",
  );
  expect(body).not.toContain(f.record.kathaId);
  for (const result of [missing, retired]) {
    expect(result.headers.get("Location")).toBeNull();
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  }
});
it("rejects invalid identifiers and all query fields before reading storage", async () => {
  const f = fixture();
  for (const path of [
    "/nfc/invalid",
    `/nfc/${f.record.tagId.toUpperCase()}`,
    `${f.path}?url=https://evil.example`,
    `${f.path}?next=/art/other`,
    `${f.path}?tagId=x&tagId=y`,
  ]) {
    const result = await f.app.request(path);
    expect(result.status).toBe(400);
    expect(result.headers.get("Location")).toBeNull();
    expect(result.headers.get("Cache-Control")).toBe("no-store");
  }
  expect(f.store.find).not.toHaveBeenCalled();
});
it("storage and corrupt-binding failures are sanitized and never redirect", async () => {
  const f = fixture();
  vi.mocked(f.store.find).mockRejectedValueOnce(new Error("PRIVATE_DATABASE_PASSWORD"));
  vi.mocked(f.store.find).mockResolvedValueOnce({
    ...f.record,
    kathaId: "//evil.example",
  });
  vi.mocked(f.store.find).mockResolvedValueOnce({ ...f.record, tagId: randomUUID() });
  vi.mocked(f.store.find).mockResolvedValueOnce({
    ...f.record,
    retiredAt: new Date(NaN),
  });
  for (let i = 0; i < 4; i++) {
    const result = await f.app.request(f.path);
    expect(result.status).toBe(500);
    expect(result.headers.get("Location")).toBeNull();
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(await result.text()).not.toContain("PRIVATE");
  }
  expect(f.logs.join("\n")).not.toContain("PRIVATE");
});
it.each([
  "javascript:alert(1)",
  "//evil.example",
  "https://user:password@katha.fun",
  "https://katha.fun/art/",
  "https://katha.fun?next=x",
  "https://katha.fun#x",
  " https://katha.fun",
])("rejects an unsafe configured origin %s", (origin) => {
  expect(() => fixture(origin)).toThrow();
});
it("HEAD resolves consistently and write methods cannot change public bindings", async () => {
  const f = fixture();
  const head = await f.app.request(f.path, { method: "HEAD" });
  expect(head.status).toBe(302);
  expect(await head.text()).toBe("");
  expect(head.headers.get("Location")).toBe(
    `https://katha.fun/art/${f.record.kathaId}`,
  );
  vi.mocked(f.store.find).mockClear();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    expect((await f.app.request(f.path, { method })).status).toBe(404);
  }
  expect(f.store.find).not.toHaveBeenCalled();
});
