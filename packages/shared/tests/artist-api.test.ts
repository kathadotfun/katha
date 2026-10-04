import { expect, it } from "vitest";
import {
  artistCreateRequestSchema,
  artistIdParamsSchema,
  artistVerificationRequestSchema,
  artistResponseSchema,
} from "../src/artist-api.js";
const profile = {
  slug: "fictional-patan-artist",
  displayName: "Fictional artist",
  biography: "Synthetic cultural biography.\nCreated only for tests.",
  region: "Patan",
  traditions: ["Paubha"],
};
it("allows manual onboarding without wallets and defaults public links", () => {
  expect(artistCreateRequestSchema.parse(profile).publicLinks).toEqual([]);
  expect(
    artistCreateRequestSchema.parse({
      ...profile,
      creatorWallet: null,
      payoutWallet: null,
    }).creatorWallet,
  ).toBeNull();
});
it.each([
  { slug: "Bad Slug" },
  { displayName: " " },
  { biography: "\n " },
  { biography: "x".repeat(5001) },
  { biography: "contains\u0000null" },
  { region: " " },
  { traditions: [] },
  { traditions: ["\u001f"] },
  { publicLinks: ["javascript:alert(1)"] },
  { publicLinks: ["https://user:secret@example.com"] },
  { publicLinks: ["https://example.com/ space"] },
  { profileImageUrl: "file:///secret" },
  { profileImageUrl: "not-a-url" },
  { publicLinks: ["not-a-url"] },
  { id: "00000000-0000-0000-0000-000000000000" },
  { verificationStatus: "VERIFIED" },
  { verifiedByWallet: "forged" },
  { privateEvidence: "secret" },
])("rejects unsafe or privileged creation fields %j", (invalid) => {
  expect(artistCreateRequestSchema.safeParse({ ...profile, ...invalid }).success).toBe(
    false,
  );
});
it.each([
  {},
  { confirmed: false },
  { confirmed: true, verifiedAt: "2026-10-05" },
  { confirmed: true, verifiedByWallet: "forged" },
  { confirmed: true, evidence: "private" },
])("requires strict deliberate manual approval %j", (input) => {
  expect(artistVerificationRequestSchema.safeParse(input).success).toBe(false);
});
it("validates canonical artist IDs and consistent verification responses", () => {
  expect(
    artistIdParamsSchema.parse({ artistId: "123E4567-E89B-42D3-A456-426614174000" })
      .artistId,
  ).toBe("123e4567-e89b-42d3-a456-426614174000");
  expect(artistIdParamsSchema.safeParse({ artistId: "bad" }).success).toBe(false);
  const response = {
    ...profile,
    publicLinks: [],
    creatorWallet: null,
    payoutWallet: null,
    profileImageUrl: null,
    id: "123e4567-e89b-42d3-a456-426614174000",
    verificationStatus: "UNVERIFIED",
    verifiedByWallet: null,
    verifiedAt: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
  expect(artistResponseSchema.safeParse(response).success).toBe(true);
  expect(
    artistResponseSchema.safeParse({ ...response, verificationStatus: "VERIFIED" })
      .success,
  ).toBe(false);
});
