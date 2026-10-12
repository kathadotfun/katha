import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artistCanonicalUrl,
  artistWorksOffset,
  artistWorksUrl,
  loadArtistWorks,
  loadPublicArtist,
} from "../lib/artist-page.ts";
import { PublicApiError, createPublicApi } from "../lib/public-api.ts";
import { artistFixture } from "./fixtures/artist.ts";
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
  pagination: { limit: 12, offset: 0, hasMore: false, total: 1 },
};
test("artist slug and profile identity are validated before rendering, with not-found distinct from failures", async () => {
  for (const slug of ["../admin", "Uppercase", "artist?private=1"])
    assert.equal(
      await loadPublicArtist(slug, async () => {
        assert.fail("must not fetch");
      }),
      null,
    );
  assert.deepEqual(
    await loadPublicArtist(artistFixture.slug, async () => artistFixture),
    artistFixture,
  );
  assert.equal(
    await loadPublicArtist("missing-artist", async () => {
      throw new PublicApiError("NOT_FOUND");
    }),
    null,
  );
  await assert.rejects(
    loadPublicArtist(artistFixture.slug, async () => ({
      ...artistFixture,
      slug: "other-artist",
    })),
  );
  await assert.rejects(
    loadPublicArtist(artistFixture.slug, async () => ({
      ...artistFixture,
      verificationStatus: "UNVERIFIED",
    })),
  );
  await assert.rejects(
    loadPublicArtist(artistFixture.slug, async () => ({
      ...artistFixture,
      payoutWallet: "PRIVATE",
    })),
  );
  await assert.rejects(
    loadPublicArtist(artistFixture.slug, async () => {
      throw new PublicApiError("UNAVAILABLE");
    }),
  );
});
test("artist work queries are bounded, identify immutable authorship and preserve paging", async () => {
  assert.equal(artistWorksOffset({}), 0);
  assert.equal(artistWorksOffset({ offset: "12" }), 12);
  for (const params of [
    { offset: "01" },
    { offset: "1" },
    { offset: ["12", "24"] },
    { offset: "100008" },
    { artistId: "other" },
  ])
    assert.equal(artistWorksOffset(params), null);
  assert.equal(
    artistCanonicalUrl(artistFixture.slug),
    `https://katha.fun/artists/${artistFixture.slug}`,
  );
  assert.equal(
    artistWorksUrl(artistFixture.slug, 12),
    `/artists/${artistFixture.slug}?offset=12#artist-works`,
  );
  const works = await loadArtistWorks(artistFixture, {}, async (query) => {
    assert.deepEqual(query, { artistId: artistFixture.id, limit: "12", offset: "0" });
    return page;
  });
  assert.equal(works.kind, "READY");
  assert.equal(
    (
      await loadArtistWorks(artistFixture, { offset: "1" }, async () => {
        assert.fail("must not fetch");
      })
    ).kind,
    "INVALID_QUERY",
  );
});
test("other artists, mismatched pagination, duplicates and failures never become artist works", async () => {
  for (const response of [
    {
      ...page,
      items: [
        {
          ...summary,
          artist: { ...summary.artist, id: "dddddddd-1111-4111-8111-111111111111" },
        },
      ],
    },
    { ...page, items: [{ ...summary, artist: { ...summary.artist, slug: "other" } }] },
    { ...page, pagination: { ...page.pagination, offset: 12 } },
    { ...page, items: [summary, summary] },
    { ...page, privateEvidence: "PRIVATE" },
  ])
    assert.equal(
      (await loadArtistWorks(artistFixture, {}, async () => response)).kind,
      "UNAVAILABLE",
    );
  assert.equal(
    (await loadArtistWorks(artistFixture, {}, async () => ({ ...page, items: [] })))
      .kind,
    "READY",
  );
  assert.equal(
    (
      await loadArtistWorks(artistFixture, {}, async () => {
        throw new Error("PRIVATE");
      })
    ).kind,
    "UNAVAILABLE",
  );
});
test("public client sends artist filtering and rejects malformed artist IDs before requests", async () => {
  const api = createPublicApi("http://localhost:3001", {
    fetch: async (url) => {
      assert.equal(new URL(String(url)).searchParams.get("artistId"), artistFixture.id);
      return new Response(JSON.stringify(page), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(
    await api.artworks({ artistId: artistFixture.id, limit: "12" }),
    page,
  );
  assert.throws(() => api.artworks({ artistId: "not-an-artist-id" }));
});
