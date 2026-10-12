import { artworkDraftUpdateRequestSchema } from "../src/artwork-draft-api.js";
import { expect, it } from "vitest";
import {
  artworkDraftListResponseSchema,
  artworkDraftListQuerySchema,
  artworkDraftCreateRequestSchema,
  artworkDraftResponseSchema,
} from "../src/artwork-draft-api.js";
const input = {
  creationRequestId: "aaaaaaaa-1111-4111-8111-111111111111",
  artistId: "bbbbbbbb-1111-4111-8111-111111111111",
  category: "PAUBHA",
  title: "Synthetic artwork",
  creationYear: 2026,
};
const response = {
  materials: [],
  artistId: input.artistId,
  category: input.category,
  title: input.title,
  creationYear: 2026,
  id: "cccccccc-1111-4111-8111-111111111111",
  kathaId: "KATHA-PAUBHA-000001",
  creatorWallet: null,
  authorshipEvidenceHash: null,
  dimensions: null,
  origin: { countryCode: "NP", region: null, locality: null },
  technique: null,
  story: null,
  meaning: null,
  culturalContext: null,
  creationProcess: null,
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
};
it("accepts minimal drafts and normalizes UUID identities", () => {
  expect(
    artworkDraftCreateRequestSchema.parse({
      ...input,
      artistId: input.artistId.toUpperCase(),
      creationRequestId: input.creationRequestId.toUpperCase(),
    }),
  ).toEqual(input);
  expect(artworkDraftResponseSchema.safeParse(response).success).toBe(true);
});
it.each(["creationRequestId", "artistId", "category", "title", "creationYear"])(
  "requires %s",
  (key) => {
    const body: Record<string, unknown> = { ...input };
    delete body[key];
    expect(artworkDraftCreateRequestSchema.safeParse(body).success).toBe(false);
  },
);
it("requires whole, bounded dimensions when supplied", () => {
  for (const dimensions of [
    { heightMm: 1 },
    { heightMm: 1, widthMm: 0 },
    { heightMm: 1.1, widthMm: 2 },
    { heightMm: 1, widthMm: 2147483648 },
  ])
    expect(
      artworkDraftCreateRequestSchema.safeParse({ ...input, dimensions }).success,
    ).toBe(false);
});
it("rejects mismatched or forged response identities and private extra fields", () => {
  expect(
    artworkDraftResponseSchema.safeParse({ ...response, materials: undefined }).success,
  ).toBe(false);
  for (const patch of [
    { kathaId: "KATHA-MANDALA-000001" },
    { kathaId: "KATHA-PAUBHA-000000" },
    { payoutWallet: "private" },
    { creationRequestId: input.creationRequestId },
  ])
    expect(
      artworkDraftResponseSchema.safeParse({ ...response, ...patch }).success,
    ).toBe(false);
});

it("accepts partial edits without replacing omitted fields", () => {
  expect(
    artworkDraftUpdateRequestSchema.parse({
      expectedUpdatedAt: "2026-10-05T00:00:00.123Z",
      story: null,
    }),
  ).toEqual({ expectedUpdatedAt: "2026-10-05T00:00:00.123Z", story: null });
});
it.each([
  {},
  { expectedUpdatedAt: "2026-10-05T00:00:00.123Z" },
  { expectedUpdatedAt: "2026-10-05T00:00:00.123Z", title: undefined },
  { expectedUpdatedAt: "2026-10-05T00:00:00Z", title: "Edited" },
  { expectedUpdatedAt: "2026-10-05T00:00:00.123Z", artistId: input.artistId },
  { expectedUpdatedAt: "2026-10-05T00:00:00.123Z", creationYear: 2025 },
])("rejects empty, unversioned or identity-changing edits %j", (body) => {
  expect(artworkDraftUpdateRequestSchema.safeParse(body).success).toBe(false);
});

it("bounds draft-list pagination and rejects privileged fields, duplicated or mismatched identities", () => {
  expect(artworkDraftListQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  for (const query of [
    { limit: "101" },
    { offset: "100001" },
    { artistId: input.artistId },
  ])
    expect(artworkDraftListQuerySchema.safeParse(query).success).toBe(false);
  const item = {
    id: response.id,
    kathaId: response.kathaId,
    category: input.category,
    title: input.title,
    creationYear: input.creationYear,
    artist: {
      id: input.artistId,
      displayName: "Synthetic artist",
      verificationStatus: "UNVERIFIED",
    },
    workflowStatus: "DOCUMENTING",
    createdAt: response.createdAt,
    updatedAt: response.updatedAt,
  };
  const page = {
    items: [item],
    pagination: { limit: 20, offset: 0, hasMore: false, total: 1 },
  };
  expect(artworkDraftListResponseSchema.safeParse(page).success).toBe(true);
  // The total must agree with the page: never below what is shown, and
  // "more pages" only when the total says so.
  for (const pagination of [
    { limit: 20, offset: 0, hasMore: false, total: 0 },
    { limit: 20, offset: 0, hasMore: true, total: 1 },
    { limit: 20, offset: 0, hasMore: false, total: 2 },
    { limit: 20, offset: 0, hasMore: false },
  ])
    expect(
      artworkDraftListResponseSchema.safeParse({ ...page, pagination }).success,
    ).toBe(false);
  for (const items of [
    [item, item],
    [{ ...item, category: "THANGKA" }],
    [{ ...item, privateEvidence: "private" }],
    [{ ...item, workflowStatus: "MINTED" }],
  ])
    expect(artworkDraftListResponseSchema.safeParse({ ...page, items }).success).toBe(
      false,
    );
});

it("validates bounded individual material names and keeps permanent attribution out of updates", () => {
  for (const materials of [
    ["Silk", "silk"],
    ["Pigment, silk"],
    [""],
    ["A\nB"],
    Array.from({ length: 21 }, (_, i) => `Material ${i}`),
  ]) {
    expect(
      artworkDraftCreateRequestSchema.safeParse({ ...input, materials }).success,
    ).toBe(false);
  }
  expect(
    artworkDraftCreateRequestSchema.parse({
      ...input,
      materials: [" Silk ", "Mineral pigment"],
    }).materials,
  ).toEqual(["Silk", "Mineral pigment"]);
  expect(
    artworkDraftUpdateRequestSchema.parse({
      expectedUpdatedAt: "2026-10-06T00:00:00.000Z",
      materials: [],
    }).materials,
  ).toEqual([]);
});
