import { publicArtistDetailSchema } from "@katha/shared";
import { artworkFixture } from "./artwork.ts";
export const artistFixture = publicArtistDetailSchema.parse({
  id: artworkFixture.artist.id,
  slug: artworkFixture.artist.slug,
  displayName: artworkFixture.artist.displayName,
  region: "Patan, Nepal",
  traditions: ["Paubha"],
  biography: "Synthetic artist biography.\nA second paragraph.",
  profileImageUrl: null,
  publicLinks: ["https://example.com/synthetic-artist"],
  creatorWallet: null,
  verificationStatus: "VERIFIED",
  verifiedAt: "2026-10-05T00:00:00.000Z",
  artworks: [],
});
