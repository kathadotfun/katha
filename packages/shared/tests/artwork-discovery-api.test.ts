import { expect, it } from "vitest";
import {
  artworkDiscoveryQuerySchema,
  publicArtworkSummarySchema,
} from "../src/artwork-discovery-api.js";
const summary = {
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA",
  title: "Synthetic work",
  creationYear: 2026,
  artist: {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    slug: "synthetic-artist",
    displayName: "Synthetic artist",
  },
  heroImage: null,
};
it("applies bounded pagination defaults", () =>
  expect(artworkDiscoveryQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 }));
it.each(["PAUBHA", "MANDALA", "THANGKA"])("accepts category %s", (category) =>
  expect(artworkDiscoveryQuerySchema.parse({ category }).category).toBe(category),
);
it("accepts a minimal public card without a public hero", () =>
  expect(publicArtworkSummarySchema.safeParse(summary).success).toBe(true));
it.each([
  { kathaId: "KATHA-MANDALA-000001" },
  { authorshipEvidenceHash: "private" },
  { artist: { ...summary.artist, payoutWallet: "private" } },
  {
    heroImage: {
      id: summary.artist.id,
      contentHash: "a".repeat(64),
      altText: "Approved image",
      storageKey: "private",
    },
  },
])("rejects inconsistent or private summary fields %j", (extra) =>
  expect(publicArtworkSummarySchema.safeParse({ ...summary, ...extra }).success).toBe(
    false,
  ),
);

it("requires the approved hero MIME type for correct public delivery", () => {
  const hero = {
    id: summary.artist.id,
    contentHash: "a".repeat(64),
    altText: "Approved image",
    mimeType: "image/png",
  };
  expect(
    publicArtworkSummarySchema.parse({ ...summary, heroImage: hero }).heroImage
      ?.mimeType,
  ).toBe("image/png");
  const missing = { id: hero.id, contentHash: hero.contentHash, altText: hero.altText };
  expect(
    publicArtworkSummarySchema.safeParse({ ...summary, heroImage: missing }).success,
  ).toBe(false);
});

it("accepts an immutable artist ID filter and rejects malformed or repeated IDs", () => {
  expect(
    artworkDiscoveryQuerySchema.parse({ artistId: summary.artist.id }).artistId,
  ).toBe(summary.artist.id);
  for (const artistId of ["private", "", [summary.artist.id, summary.artist.id]])
    expect(artworkDiscoveryQuerySchema.safeParse({ artistId }).success).toBe(false);
});
