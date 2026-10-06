import { it, expect } from "vitest";
import {
  artworkMediaUploadSchema,
  artworkMediaUpdateSchema,
  artworkMediaResponseSchema,
} from "../src/artwork-media-api.js";
const input = {
  expectedUpdatedAt: "2026-10-06T00:00:00.000Z",
  mimeType: "image/png",
  role: "FRONT",
  visibility: "PRIVATE",
  altText: null,
  caption: null,
  approvedPublic: false,
};
it("keeps publication explicit and validates image descriptions and supported roles/types", () => {
  expect(artworkMediaUploadSchema.safeParse(input).success).toBe(true);
  for (const patch of [
    { mimeType: "image/svg+xml" },
    { role: "unknown" },
    { visibility: "PUBLIC" },
    { visibility: "PUBLIC", approvedPublic: true },
    { visibility: "PUBLIC", approvedPublic: true, altText: "Photo", role: "CONDITION" },
    { role: "HERO", mimeType: "application/pdf" },
    { caption: "\u0000" },
    { storageKey: "public/forged" },
  ])
    expect(artworkMediaUploadSchema.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
  expect(
    artworkMediaUploadSchema.safeParse({
      ...input,
      visibility: "PUBLIC",
      approvedPublic: true,
      altText: "Approved photograph",
    }).success,
  ).toBe(true);
});
it("requires complete unique media identities and at most one hero", () => {
  const item = {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    role: "HERO",
    visibility: "PRIVATE",
    altText: null,
    caption: null,
    approvedPublic: false,
  };
  expect(
    artworkMediaUpdateSchema.safeParse({
      expectedUpdatedAt: input.expectedUpdatedAt,
      items: [item],
    }).success,
  ).toBe(true);
  expect(
    artworkMediaUpdateSchema.safeParse({
      expectedUpdatedAt: input.expectedUpdatedAt,
      items: [item, item],
    }).success,
  ).toBe(false);
  expect(
    artworkMediaUpdateSchema.safeParse({
      expectedUpdatedAt: input.expectedUpdatedAt,
      items: [item, { ...item, id: "bbbbbbbb-1111-4111-8111-111111111111" }],
    }).success,
  ).toBe(false);
  expect(
    artworkMediaResponseSchema.safeParse({
      kathaId: "KATHA-PAUBHA-000001",
      updatedAt: input.expectedUpdatedAt,
      editable: true,
      items: [],
      privatePath: "/tmp/private",
    }).success,
  ).toBe(false);
});
