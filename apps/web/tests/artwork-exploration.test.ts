import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explorationPhotoUrl,
  explorationUrl,
  loadExploration,
  parseExplorationQuery,
} from "../lib/artwork-exploration.ts";
import { artworkFixture } from "./fixtures/artwork.ts";

export const summaryFixture = {
  kathaId: artworkFixture.kathaId,
  category: artworkFixture.category,
  title: artworkFixture.title,
  creationYear: artworkFixture.creationYear,
  artist: artworkFixture.artist,
  heroImage: {
    id: artworkFixture.media[0]!.id,
    contentHash: artworkFixture.media[0]!.contentHash,
    mimeType: "image/png",
    altText: "Synthetic approved photograph",
  },
};
const page = {
  items: [summaryFixture],
  pagination: { limit: 12, offset: 0, hasMore: true },
};
test("category and page query uses bounded canonical values and rejects duplicate/unknown parameters", () => {
  assert.deepEqual(parseExplorationQuery({}), { offset: 0 });
  for (const category of ["MANDALA", "PAUBHA", "THANGKA"])
    assert.deepEqual(parseExplorationQuery({ category, offset: "12" }), {
      category,
      offset: 12,
    });
  for (const params of [
    { category: "paubha" },
    { category: "" },
    { category: ["PAUBHA", "THANGKA"] },
    { offset: "01" },
    { offset: "1" },
    { offset: "100008" },
    { offset: "-12" },
    { limit: "100" },
    { owner: "secret" },
  ])
    assert.equal(parseExplorationQuery(params), null);
  assert.equal(
    explorationUrl({ category: "PAUBHA", offset: 12 }),
    "/explore?category=PAUBHA&offset=12",
  );
  assert.equal(explorationUrl({ offset: 0 }), "/explore");
});
test("loader sends real API filters, rejects invalid query before fetch and validates page identity", async () => {
  assert.equal(
    (
      await loadExploration({ category: "PAUBHA" }, async (query) => {
        assert.deepEqual(query, { category: "PAUBHA", limit: "12", offset: "0" });
        return page;
      })
    ).kind,
    "READY",
  );
  assert.equal(
    (
      await loadExploration({ category: "PRIVATE" }, async () => {
        assert.fail("must not fetch");
      })
    ).kind,
    "INVALID_QUERY",
  );
  for (const value of [
    { ...page, pagination: { ...page.pagination, offset: 12 } },
    { ...page, pagination: { ...page.pagination, limit: 20 } },
    {
      ...page,
      items: [
        { ...summaryFixture, category: "THANGKA", kathaId: "KATHA-THANGKA-000001" },
      ],
    },
    { ...page, items: [summaryFixture, summaryFixture] },
    { ...page, privateEvidence: "PRIVATE" },
  ])
    assert.equal(
      (await loadExploration({ category: "PAUBHA" }, async () => value)).kind,
      "UNAVAILABLE",
    );
});
test("empty publication pages stay distinct from unavailable API responses", async () => {
  const empty = await loadExploration({}, async () => ({ ...page, items: [] }));
  assert.equal(empty.kind, "READY");
  const failure = await loadExploration(
    { category: "PAUBHA", offset: "12" },
    async () => {
      throw new Error("PRIVATE_DATABASE_PASSWORD");
    },
  );
  assert.deepEqual(failure, {
    kind: "UNAVAILABLE",
    query: { category: "PAUBHA", offset: 12 },
  });
  assert.ok(!JSON.stringify(failure).includes("PRIVATE"));
});
test("hero photography uses actual MIME extensions and fixed public storage only", () => {
  const hero = summaryFixture.heroImage;
  for (const [mimeType, extension] of [
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
  ])
    assert.equal(
      explorationPhotoUrl("http://localhost:3001", { ...hero, mimeType: mimeType! }),
      `http://localhost:3001/storage/public/${hero.contentHash}.${extension}`,
    );
  assert.equal(explorationPhotoUrl("http://localhost:3001", null), null);
  assert.equal(
    explorationPhotoUrl("http://localhost:3001", {
      ...hero,
      mimeType: "image/svg+xml",
    }),
    null,
  );
  assert.equal(
    explorationPhotoUrl("http://localhost:3001", {
      ...hero,
      contentHash: "../../private",
    }),
    null,
  );
});
