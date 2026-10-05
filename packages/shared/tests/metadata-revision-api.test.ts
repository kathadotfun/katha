import { expect, it } from "vitest";
import { metadataRevisionRequestSchema } from "../src/index.js";
const request = {
  idempotencyKey: "synthetic-metadata",
  expectedUpdatedAt: "2026-10-05T00:00:00.000Z",
  metadataVersionId: "11111111-1111-4111-8111-111111111111",
  expectedMetadataVersion: 1,
  expectedMetadataHash: "a".repeat(64),
  supportedTransactionVersions: [0],
};
it("accepts first commitments and advancing revisions", () => {
  expect(metadataRevisionRequestSchema.safeParse(request).success).toBe(true);
  expect(
    metadataRevisionRequestSchema.safeParse({
      ...request,
      expectedMetadataVersion: 0,
      expectedMetadataHash: null,
    }).success,
  ).toBe(true);
});
it.each([
  { expectedMetadataVersion: -1 },
  { expectedMetadataVersion: 4294967295 },
  { expectedMetadataVersion: 1.5 },
  { expectedMetadataVersion: 0 },
  { expectedMetadataHash: null },
  { expectedMetadataHash: "invalid" },
  { uri: "https://private" },
  { artistId: "11111111-1111-4111-8111-111111111111" },
  { supportedTransactionVersions: [0, 0] },
])("rejects %j", (change) => {
  expect(
    metadataRevisionRequestSchema.safeParse({ ...request, ...change }).success,
  ).toBe(false);
});
