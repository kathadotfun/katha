import { describe, expect, it } from "vitest";

import {
  artistAttributionSchema,
  artistProfileSchema,
  artworkSchema,
  walletAddressSchema,
} from "../src/artwork-domain.js";

const artistId = "e9ef8e61-6b79-42cc-ae58-2e9a82610347";
const creatorWallet = "11111111111111111111111111111111";
const payoutWallet = "22222222222222222222222222222222";

const validArtist = () => ({
  attribution: {
    artistId,
    displayName: "Asha Lama",
  },
  biography: "A Nepali painter working in traditional forms.",
  region: "Bagmati",
  traditions: ["Paubha"],
  publicLinks: ["https://example.org/artist"],
});

const validArtwork = () => ({
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA",
  title: "Lotus Mandala",
  attribution: validArtist().attribution,
  authorshipEvidenceHash: "a".repeat(64),
  creationYear: 2025,
  origin: {
    countryCode: "NP",
    region: "Bagmati",
    locality: "Patan",
  },
  dimensions: { heightMm: 640, widthMm: 480 },
  materials: ["Cotton canvas", "Mineral pigments"],
  technique: "Hand painted",
  publicContent: {
    story: "A story about the work.",
    meaning: "Its artistic meaning.",
    culturalContext: "The tradition around the work.",
    creationProcess: "How the artist made it.",
  },
});

describe("artist identity and wallets", () => {
  it("accepts an artist without either wallet", () => {
    expect(artistProfileSchema.parse(validArtist()).attribution.artistId).toBe(
      artistId,
    );
  });

  it("keeps creator and payout wallets independent of artist identity", () => {
    const artist = validArtist();
    const withWallets = artistProfileSchema.parse({
      ...artist,
      attribution: { ...artist.attribution, creatorWallet },
      payoutWallet,
    });

    expect(withWallets.attribution.artistId).toBe(artistId);
    expect(withWallets.attribution.creatorWallet).toBe(creatorWallet);
    expect(withWallets.payoutWallet).toBe(payoutWallet);
    expect(
      artistAttributionSchema.parse(artist.attribution).creatorWallet,
    ).toBeUndefined();
  });

  it("allows a payout wallet without a creator wallet", () => {
    const artist = artistProfileSchema.parse({ ...validArtist(), payoutWallet });
    expect(artist.attribution.creatorWallet).toBeUndefined();
    expect(artist.payoutWallet).toBe(payoutWallet);
  });

  it("accepts explicit null wallets", () => {
    const artist = validArtist();
    expect(
      artistProfileSchema.safeParse({
        ...artist,
        attribution: { ...artist.attribution, creatorWallet: null },
        payoutWallet: null,
      }).success,
    ).toBe(true);
  });

  it.each(["not-a-wallet", "0".repeat(32), "1111111111111111111111111111111"])(
    "rejects malformed wallet %s",
    (wallet) => {
      expect(walletAddressSchema.safeParse(wallet).success).toBe(false);
    },
  );

  it("rejects blank attribution and unsafe public links", () => {
    expect(
      artistAttributionSchema.safeParse({
        ...validArtist().attribution,
        displayName: "  ",
      }).success,
    ).toBe(false);
    expect(
      artistProfileSchema.safeParse({
        ...validArtist(),
        publicLinks: ["javascript:alert(1)"],
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid artist ID and unlisted private fields", () => {
    expect(
      artistAttributionSchema.safeParse({
        ...validArtist().attribution,
        artistId: "not-an-id",
      }).success,
    ).toBe(false);
    expect(
      artistProfileSchema.safeParse({ ...validArtist(), privateEvidence: "not public" })
        .success,
    ).toBe(false);
  });
});

describe("structured artwork documentation", () => {
  it("accepts a complete artwork without a creator wallet", () => {
    expect(artworkSchema.parse(validArtwork()).kathaId).toBe("KATHA-PAUBHA-000001");
  });

  it("rejects a category that disagrees with its permanent ID", () => {
    expect(
      artworkSchema.safeParse({ ...validArtwork(), category: "THANGKA" }).success,
    ).toBe(false);
  });

  it.each([
    { dimensions: { heightMm: 0, widthMm: 480 } },
    { dimensions: { heightMm: 640.5, widthMm: 480 } },
    { dimensions: { heightMm: 640, widthMm: 480, depthMm: -1 } },
    { materials: [] },
    { materials: ["   "] },
    { origin: { countryCode: "np", region: "Bagmati" } },
    { authorshipEvidenceHash: "A".repeat(64) },
    { authorshipEvidenceHash: "a".repeat(63) },
    { creationYear: 0 },
    { creationYear: 2025.5 },
  ])("rejects invalid structured values %#", (change) => {
    expect(artworkSchema.safeParse({ ...validArtwork(), ...change }).success).toBe(
      false,
    );
  });

  it("rejects blank public text and unlisted private fields", () => {
    const artwork = validArtwork();
    expect(
      artworkSchema.safeParse({
        ...artwork,
        publicContent: { ...artwork.publicContent, story: "  " },
      }).success,
    ).toBe(false);
    expect(
      artworkSchema.safeParse({
        ...artwork,
        publicContent: { ...artwork.publicContent, shippingAddress: "private" },
      }).success,
    ).toBe(false);
  });
});
