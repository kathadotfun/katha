import { expect, it, vi } from "vitest";
import type { PublicArtworkStore } from "@katha/db";
import { artworkDiscoveryResponseSchema } from "@katha/shared";
import { createArtworkDiscovery } from "../src/artwork-discovery.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
const row = {
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA" as const,
  title: "Synthetic public artwork",
  creationYear: 2026,
  artist: {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    slug: "synthetic-artist",
    displayName: "Synthetic artist",
    payoutWallet: "PRIVATE-PAYOUT",
  },
  heroImage: {
    id: "bbbbbbbb-1111-4111-8111-111111111111",
    contentHash: "a".repeat(64),
    mimeType: "image/png",
    altText: "Synthetic approved image",
    storageKey: "PRIVATE-STORAGE-KEY",
    caption: "PRIVATE-FUTURE-FIELD",
  },
  authorshipEvidenceHash: "PRIVATE-EVIDENCE",
  creationRequestId: "PRIVATE-REQUEST",
  total: 4,
};
const page = (
  rows: (typeof row | (Omit<typeof row, "heroImage"> & { heroImage: null }))[],
  total = 4,
) => ({
  rows,
  total,
});
function fixture() {
  const store: PublicArtworkStore = {
    list: vi.fn(async () => page([row, { ...row, kathaId: "KATHA-PAUBHA-000002" }])),
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
    createArtworkDiscovery(store),
  );
  return { app, store, logs };
}
it("lists public summaries anonymously with category filtering and bounded pagination", async () => {
  const { app, store } = fixture();
  const response = await app.request("/artworks?category=PAUBHA&limit=1&offset=2");
  expect(response.status).toBe(200);
  const body = artworkDiscoveryResponseSchema.parse(await response.json());
  expect(body.items).toHaveLength(1);
  expect(body.pagination).toEqual({ limit: 1, offset: 2, hasMore: true, total: 4 });
  expect(store.list).toHaveBeenCalledWith({ category: "PAUBHA", limit: 1, offset: 2 });
  expect(body.items[0]?.heroImage?.mimeType).toBe("image/png");
  expect(body.items[0]?.heroImage?.altText).toBe(row.heroImage.altText);
  expect(JSON.stringify(body)).not.toContain("PRIVATE");
});
it("uses defaults and reports an empty page", async () => {
  const { app, store } = fixture();
  vi.mocked(store.list).mockResolvedValue(page([], 0));
  expect(await (await app.request("/artworks")).json()).toEqual({
    items: [],
    pagination: { limit: 20, offset: 0, hasMore: false, total: 0 },
  });
});
it("rejects a total that contradicts the page instead of publishing it", async () => {
  const { app, store } = fixture();
  vi.mocked(store.list).mockResolvedValue(page([row, row], 1));
  expect((await app.request("/artworks?limit=1")).status).toBe(500);
});
it("allows a missing public hero without exposing a private fallback", async () => {
  const { app, store } = fixture();
  vi.mocked(store.list).mockResolvedValue(page([{ ...row, heroImage: null }], 1));
  const body = artworkDiscoveryResponseSchema.parse(
    await (await app.request("/artworks")).json(),
  );
  expect(body.items[0]?.heroImage).toBeNull();
});
it.each([
  "category=paubha",
  "category=NFT",
  "category=",
  "category=PAUBHA&category=THANGKA",
  "limit=0",
  "limit=101",
  "limit=01",
  "offset=-1",
  "offset=100001",
  "limit=1&limit=2",
  "published=true",
  "visibility=PRIVATE",
  "cluster=DEVNET",
  "search=anything",
])("rejects invalid discovery query %s before storage", async (query) => {
  const { app, store } = fixture();
  expect((await app.request(`/artworks?${query}`)).status).toBe(400);
  expect(store.list).not.toHaveBeenCalled();
});
it("redacts storage failures from responses and logs", async () => {
  const { app, store, logs } = fixture();
  vi.mocked(store.list).mockRejectedValue(new Error("PRIVATE-DATABASE-URL"));
  const response = await app.request("/artworks");
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(logs.join("")).not.toContain("PRIVATE");
});

it("passes the validated artist ID through public discovery without changing publication semantics", async () => {
  const { app, store } = fixture();
  const response = await app.request(`/artworks?artistId=${row.artist.id}&limit=1`);
  expect(response.status).toBe(200);
  expect(store.list).toHaveBeenCalledWith({
    artistId: row.artist.id,
    limit: 1,
    offset: 0,
  });
  const body = artworkDiscoveryResponseSchema.parse(await response.json());
  expect(body.items[0]?.artist.id).toBe(row.artist.id);
});
it.each(["not-an-id", "", "111", "../admin"])(
  "rejects invalid artist ID %s before storage",
  async (artistId) => {
    const { app, store } = fixture();
    expect(
      (await app.request(`/artworks?artistId=${encodeURIComponent(artistId)}`)).status,
    ).toBe(400);
    expect(store.list).not.toHaveBeenCalled();
  },
);
