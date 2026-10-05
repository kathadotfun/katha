import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artworkCanonicalUrl,
  artworkDimensionsLabel,
  artworkOriginLabel,
  artworkPhotos,
  artworkPhotoUrl,
  artworkPhotoLabel,
  loadPublicArtwork,
} from "../lib/artwork-page.ts";
import { createPublicApi, PublicApiError } from "../lib/public-api.ts";
import { artworkFixture } from "./fixtures/artwork.ts";

const image = artworkFixture.media[0]!;

test("invalid permanent IDs are missing without fetching, including title slugs and traversal", async () => {
  for (const id of [
    "paubha-study",
    "KATHA-PAUBHA-000000",
    "../admin",
    "KATHA-PAUBHA-000001?private=1",
  ]) {
    assert.equal(
      await loadPublicArtwork(id, async () => assert.fail("must not fetch")),
      null,
    );
  }
});

test("only a matching artwork is shown at its permanent URL", async () => {
  assert.equal(
    await loadPublicArtwork(artworkFixture.kathaId, async (id) => {
      assert.equal(id, artworkFixture.kathaId);
      return artworkFixture;
    }),
    artworkFixture,
  );
  await assert.rejects(
    loadPublicArtwork(artworkFixture.kathaId, async () => ({
      ...artworkFixture,
      kathaId: "KATHA-PAUBHA-000002",
    })),
    (error: unknown) =>
      error instanceof PublicApiError && error.kind === "INVALID_RESPONSE",
  );
});

test("a missing work is distinct from outages, invalid responses and other exceptions", async () => {
  assert.equal(
    await loadPublicArtwork(artworkFixture.kathaId, async () => {
      throw new PublicApiError("NOT_FOUND");
    }),
    null,
  );
  for (const error of [
    new PublicApiError("UNAVAILABLE"),
    new PublicApiError("INVALID_RESPONSE"),
    new PublicApiError("TIMEOUT"),
    new PublicApiError("CANCELLED"),
    new Error("internal"),
  ]) {
    await assert.rejects(
      loadPublicArtwork(artworkFixture.kathaId, async () => {
        throw error;
      }),
      (actual: unknown) => actual === error,
    );
  }
});

test("canonical identity is independent of title, artist, owner and local services", () => {
  assert.equal(
    artworkCanonicalUrl(artworkFixture.kathaId),
    "https://katha.fun/art/KATHA-PAUBHA-000001",
  );
  assert.throws(() => artworkCanonicalUrl("invalid"));
});

test("photos are ordered without mutation, preferring HERO then FRONT", () => {
  const media = [
    { ...image, id: "detail", role: "DETAIL" as const, position: 0 },
    { ...image, id: "front", role: "FRONT" as const, position: 2 },
    { ...image, id: "hero", role: "HERO" as const, position: 3 },
  ];
  assert.deepEqual(
    artworkPhotos({ ...artworkFixture, media }).map((photo) => photo.id),
    ["hero", "detail", "front"],
  );
  assert.deepEqual(
    media.map((photo) => photo.id),
    ["detail", "front", "hero"],
  );
  assert.equal(
    artworkPhotos({ ...artworkFixture, media: media.slice(0, 2) })[0]?.id,
    "front",
  );
  assert.equal(
    artworkPhotos({ ...artworkFixture, media: media.slice(0, 1) })[0]?.id,
    "detail",
  );
});

test("unsupported images, non-images and inspection/certificate media stay outside the photo gallery", () => {
  const media = [
    { ...image, mimeType: "image/svg+xml" },
    { ...image, mimeType: "__proto__" },
    { ...image, kind: "DOCUMENT" as const },
    { ...image, role: "CONDITION" as const },
    { ...image, role: "CERTIFICATE" as const },
  ];
  assert.deepEqual(artworkPhotos({ ...artworkFixture, media }), []);
  assert.deepEqual(artworkPhotos({ ...artworkFixture, media: [] }), []);
  assert.equal(artworkPhotoLabel("DETAIL"), "Detail view");
  assert.equal(artworkPhotoLabel("constructor"), "Artwork photograph");
});

test("photo URLs target only fixed public hash paths on the configured origin", () => {
  for (const [mimeType, extension] of [
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/avif", "avif"],
  ]) {
    assert.equal(
      artworkPhotoUrl("http://localhost:3001", { ...image, mimeType: mimeType! }),
      `http://localhost:3001/storage/public/${image.contentHash}.${extension}`,
    );
  }
  for (const media of [
    { ...image, contentHash: "../../private" },
    { ...image, mimeType: "image/svg+xml" },
    { ...image, mimeType: "constructor" },
    { ...image, kind: "VIDEO" as const },
  ]) {
    assert.throws(() => artworkPhotoUrl("http://localhost:3001", media));
  }
  assert.throws(() => artworkPhotoUrl("https://user:secret@example.com", image));
});

test("dimensions preserve exact millimetres and origin never invents a locality", () => {
  assert.equal(
    artworkDimensionsLabel(artworkFixture.dimensions),
    "720 × 510 mm (height × width)",
  );
  assert.equal(
    artworkDimensionsLabel({ heightMm: 721, widthMm: 511, depthMm: 3 }),
    "721 × 511 × 3 mm (height × width × depth)",
  );
  assert.equal(artworkDimensionsLabel(null), "Not documented");
  assert.equal(artworkOriginLabel(artworkFixture.origin), "Patan, Bagmati, Nepal");
  assert.equal(artworkOriginLabel({ countryCode: "NP", region: null }), "Nepal");
  assert.equal(artworkOriginLabel({ countryCode: "BT" }), "BT");
});

test("the page loader works through the real shared-schema public client", async () => {
  for (const status of [200, 404, 503]) {
    const api = createPublicApi("http://localhost:3001", {
      fetch: async () =>
        new Response(JSON.stringify(artworkFixture), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    });
    if (status === 200)
      assert.deepEqual(
        await loadPublicArtwork(artworkFixture.kathaId, api.artwork),
        artworkFixture,
      );
    else if (status === 404)
      assert.equal(await loadPublicArtwork(artworkFixture.kathaId, api.artwork), null);
    else
      await assert.rejects(
        loadPublicArtwork(artworkFixture.kathaId, api.artwork),
        (error: unknown) =>
          error instanceof PublicApiError && error.kind === "UNAVAILABLE",
      );
  }
});
