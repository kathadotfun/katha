import assert from "node:assert/strict";
import { test } from "node:test";
import { loadFeaturedArtworks } from "../lib/home-page.ts";
import { artworkFixture } from "./fixtures/artwork.ts";

const summary = {
  kathaId: artworkFixture.kathaId,
  category: artworkFixture.category,
  title: artworkFixture.title,
  creationYear: artworkFixture.creationYear,
  artist: artworkFixture.artist,
  heroImage: null,
};
const page = {
  items: [summary],
  pagination: { limit: 3, offset: 0, hasMore: false, total: 1 },
};

test("homepage reads only a bounded first page of the public catalogue", async () => {
  const state = await loadFeaturedArtworks(async (query) => {
    assert.deepEqual(query, { limit: "3", offset: "0" });
    return page;
  });
  assert.deepEqual(state, { kind: "READY", items: [summary] });
});

test("homepage rejects mismatched, duplicated, unordered and private catalogue responses", async () => {
  const later = { ...summary, kathaId: "KATHA-PAUBHA-000002" };
  for (const value of [
    { ...page, pagination: { ...page.pagination, limit: 12 } },
    { ...page, pagination: { ...page.pagination, offset: 3 } },
    { ...page, items: [summary, summary] },
    { ...page, items: [later, summary] },
    {
      ...page,
      items: [
        summary,
        later,
        { ...summary, kathaId: "KATHA-PAUBHA-000003" },
        { ...summary, kathaId: "KATHA-PAUBHA-000004" },
      ],
    },
    { ...page, items: [{ ...summary, privateEvidence: "PRIVATE" }] },
    { ...page, items: [{ ...summary, kathaId: "KATHA-THANGKA-000001" }] },
    { ...page, privateEvidence: "PRIVATE" },
  ])
    assert.deepEqual(await loadFeaturedArtworks(async () => value), {
      kind: "UNAVAILABLE",
    });
});

test("an empty homepage catalogue is distinct from an outage and hides upstream details", async () => {
  assert.deepEqual(await loadFeaturedArtworks(async () => ({ ...page, items: [] })), {
    kind: "READY",
    items: [],
  });
  const failure = await loadFeaturedArtworks(async () => {
    throw new Error("PRIVATE_DATABASE_PASSWORD");
  });
  assert.deepEqual(failure, { kind: "UNAVAILABLE" });
  assert.ok(!JSON.stringify(failure).includes("PRIVATE"));
});
