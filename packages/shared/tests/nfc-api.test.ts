import { nfcResolutionQuerySchema } from "../src/index.js";
import { expect, it } from "vitest";
import {
  nfcTagIdSchema,
  nfcTagAssignmentRequestSchema,
  nfcTagRetirementRequestSchema,
  nfcTagResponseSchema,
} from "../src/nfc-api.js";
const tagId = "aaaaaaaa-1111-4111-8111-111111111111";
it("accepts a canonical public UUID reference and rejects hardware IDs and unsafe strings", () => {
  expect(nfcTagIdSchema.parse(tagId)).toBe(tagId);
  for (const id of [
    "",
    "04aabbccdd",
    tagId.toUpperCase(),
    "../art",
    "https://example.com",
    " " + tagId,
  ])
    expect(nfcTagIdSchema.safeParse(id).success).toBe(false);
});
it("assignment and retirement bodies reject extra identity, actor and lifecycle fields", () => {
  expect(nfcTagAssignmentRequestSchema.parse({ tagId })).toEqual({ tagId });
  for (const extra of [
    { kathaId: "KATHA-PAUBHA-000001" },
    { assignedByWalletId: tagId },
    { retiredAt: null },
    { redirectUrl: "https://example.com" },
  ])
    expect(nfcTagAssignmentRequestSchema.safeParse({ tagId, ...extra }).success).toBe(
      false,
    );
  expect(nfcTagRetirementRequestSchema.parse({})).toEqual({});
  expect(
    nfcTagRetirementRequestSchema.safeParse({ retiredAt: "2026-01-01" }).success,
  ).toBe(false);
});
it("response separates active and retired states and requires ordered retirement time", () => {
  const record = {
    tagId,
    kathaId: "KATHA-PAUBHA-000001",
    state: "ACTIVE",
    assignedAt: "2026-10-06T00:00:00.000Z",
    retiredAt: null,
  };
  expect(nfcTagResponseSchema.safeParse(record).success).toBe(true);
  expect(
    nfcTagResponseSchema.safeParse({
      ...record,
      state: "RETIRED",
      retiredAt: "2026-10-06T00:00:01.000Z",
    }).success,
  ).toBe(true);
  for (const value of [
    { ...record, state: "RETIRED" },
    { ...record, retiredAt: record.assignedAt },
    { ...record, state: "RETIRED", retiredAt: "2025-01-01T00:00:00.000Z" },
    { ...record, privateEvidence: "PRIVATE" },
  ])
    expect(nfcTagResponseSchema.safeParse(value).success).toBe(false);
});

it("public resolution accepts no caller-supplied redirect configuration", () => {
  expect(nfcResolutionQuerySchema.parse({})).toEqual({});
  for (const value of [
    { url: "https://evil.example" },
    { next: "/art/other" },
    { origin: "https://evil.example" },
  ])
    expect(nfcResolutionQuerySchema.safeParse(value).success).toBe(false);
});
