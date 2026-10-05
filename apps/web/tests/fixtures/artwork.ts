import { publicArtworkDetailSchema } from "@katha/shared";

// Fictional documentation and test addresses; never imported by the application.
const wallet = "11111111111111111111111111111111";
const at = "2026-10-05T00:00:00.000Z";
const transaction = {
  signature: "3".repeat(88),
  slot: "9007199254740993",
  recordedAt: at,
};
const commitment = { documentHash: "a".repeat(64), transaction };

export const artworkFixture = publicArtworkDetailSchema.parse({
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA",
  title: "Synthetic Paubha study",
  creationYear: 2026,
  artist: {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    slug: "synthetic-artist",
    displayName: "Synthetic test artist",
  },
  creatorWallet: null,
  dimensions: { heightMm: 720, widthMm: 510, depthMm: null },
  origin: { countryCode: "NP", region: "Bagmati", locality: "Patan" },
  technique: "Synthetic technique description",
  story: "Synthetic story for a public artwork page.\nA second paragraph.",
  meaning: "Synthetic meaning recorded for testing.",
  culturalContext: "Synthetic cultural documentation; no historical claim.",
  creationProcess: "Synthetic creation process.",
  materials: ["Test canvas", "Test pigments"],
  media: [
    {
      id: "bbbbbbbb-1111-4111-8111-111111111111",
      kind: "IMAGE",
      role: "HERO",
      position: 0,
      contentHash: "b".repeat(64),
      mimeType: "image/png",
      altText: "Synthetic artwork image for testing",
    },
  ],
  verification: {
    status: "VERIFIED",
    verifierWallet: "Vote111111111111111111111111111111111111111",
    inspectedAt: at,
    ...commitment,
  },
  metadata: { version: 1, uri: "https://example.com/metadata.json", ...commitment },
  condition: {
    version: 1,
    grade: "GOOD",
    reason: "INITIAL_VERIFICATION",
    inspectedAt: at,
    verifierWallet: "Vote111111111111111111111111111111111111111",
    ...commitment,
  },
  custody: { state: "UNKNOWN", source: "UNKNOWN", observedAt: null },
  ownership: {
    ownerWallet: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    source: "INDEXED_CORE",
    observedAt: at,
    transaction,
  },
  chain: {
    cluster: "LOCALNET",
    coreAssetAddress: wallet,
    registryRecordAddress: null,
    collectionAddress: null,
  },
  indexing: { freshness: "UNKNOWN", checkpoint: null },
});
