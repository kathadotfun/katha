import { paginatedResponseSchema } from "@katha/shared";
import { expect, it, vi } from "vitest";
import { publicArtistDetailSchema, publicArtistSummarySchema } from "@katha/shared";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createPublicArtists } from "../src/public-artists.js";

const record = {
  id: "ad490fbb-1111-4111-8111-111111111111",
  slug: "fictional-artist",
  displayName: "Fictional Artist",
  region: "Patan",
  traditions: ["Paubha"],
  profileImageUrl: null,
  verificationStatus: "VERIFIED" as "VERIFIED" | "UNVERIFIED",
  biography: "Synthetic biography",
  publicLinks: [],
  creatorWallet: null,
  verifiedAt: new Date("2026-10-05T00:00:00Z"),
  payoutWallet: "PRIVATE-PAYOUT",
  verifiedByWallet: "PRIVATE-VERIFIER",
  privateEvidence: "PRIVATE-EVIDENCE",
};
function fixture() {
  const store = {
    list: vi.fn(async () => [record, { ...record, slug: "second" }]),
    findBySlug: vi.fn(async () => record as typeof record | undefined),
  };
  const logs: string[] = [];
  return {
    store,
    logs,
    app: createApi(
      createLogger((line) => logs.push(line)),
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      createPublicArtists(store),
    ),
  };
}
it("lists public summaries anonymously with bounded pagination and no private fields", async () => {
  const { app, store } = fixture();
  const response = await app.request("/artists?limit=1&offset=2");
  expect(response.status).toBe(200);
  const body = paginatedResponseSchema(publicArtistSummarySchema).parse(
    await response.json(),
  );
  expect(body.pagination).toEqual({ limit: 1, offset: 2, hasMore: true });
  expect(body.items).toHaveLength(1);
  expect(store.list).toHaveBeenCalledWith({ limit: 1, offset: 2 });
  expect(publicArtistSummarySchema.safeParse(body.items[0]).success).toBe(true);
  expect(body.items[0]).not.toHaveProperty("biography");
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
});
it("returns public detail and never exposes drafts or administrative fields", async () => {
  const { app } = fixture();
  const body = publicArtistDetailSchema.parse(
    await (await app.request("/artists/fictional-artist")).json(),
  );
  expect(publicArtistDetailSchema.parse(body)).toMatchObject({
    artworks: [],
    creatorWallet: null,
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
  for (const key of [
    "payoutWallet",
    "verifiedByWallet",
    "privateEvidence",
    "createdAt",
  ])
    expect(
      publicArtistDetailSchema.safeParse({ ...body, [key]: "secret" }).success,
    ).toBe(false);
});
it.each([
  "limit=0",
  "limit=101",
  "limit=01",
  "offset=-1",
  "offset=100001",
  "limit=1&limit=2",
  "search=x",
])("rejects invalid query %s before storage", async (query) => {
  const { app, store } = fixture();
  expect((await app.request(`/artists?${query}`)).status).toBe(400);
  expect(store.list).not.toHaveBeenCalled();
});
it("applies defaults and reports an empty last page", async () => {
  const { app, store } = fixture();
  store.list.mockResolvedValue([]);
  expect(await (await app.request("/artists")).json()).toEqual({
    items: [],
    pagination: { limit: 20, offset: 0, hasMore: false },
  });
});
it("rejects malformed slugs without querying storage", async () => {
  const { app, store } = fixture();
  expect((await app.request("/artists/Bad_slug")).status).toBe(400);
  expect(store.findBySlug).not.toHaveBeenCalled();
});
it("returns the same not-found response for absent and unverified profiles", async () => {
  const { app, store } = fixture();
  store.findBySlug.mockResolvedValue(undefined);
  expect((await app.request("/artists/missing")).status).toBe(404);
  store.findBySlug.mockResolvedValue({ ...record, verificationStatus: "UNVERIFIED" });
  expect((await app.request("/artists/fictional-artist")).status).toBe(404);
});
it("redacts storage failures from responses and logs", async () => {
  const { app, store, logs } = fixture();
  store.list.mockRejectedValue(new Error("PRIVATE-DATABASE-URL"));
  const response = await app.request("/artists");
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(logs.join("")).not.toContain("PRIVATE");
});
