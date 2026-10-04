import { artworkDraftUpdateRequestSchema } from "../src/artwork-draft-api.js";
import { expect, it } from "vitest";
import {
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
