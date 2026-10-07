import { expect, it } from "vitest";
import {
  artworkMintRequestSchema,
  artworkPublicationRequestSchema,
} from "../src/index.js";
const request = {
  idempotencyKey: "synthetic-mint",
  expectedUpdatedAt: "2026-10-05T00:00:00.000Z",
  metadataVersionId: "11111111-1111-4111-8111-111111111111",
  initialConditionReportId: "22222222-2222-4222-8222-222222222222",
  expectedMetadataVersion: 1,
  expectedConditionVersion: 1,
  expectedCustodyRevision: "1",
  supportedTransactionVersions: [0],
};
it("accepts exact reviewed mint prerequisites and both wallet versions", () => {
  expect(
    artworkMintRequestSchema.parse({ ...request, supportedTransactionVersions: [0, 1] })
      .expectedMetadataVersion,
  ).toBe(1);
});
it.each([
  "0",
  "01",
  "-1",
  "1.5",
  "18446744073709551616",
  "9999999999999999999999999999999",
])("rejects invalid custody revision %s", (v) => {
  expect(
    artworkMintRequestSchema.safeParse({ ...request, expectedCustodyRevision: v })
      .success,
  ).toBe(false);
});
it.each([
  { expectedMetadataVersion: 0 },
  { expectedConditionVersion: 4294967296 },
  { initialConditionReportId: "invalid" },
  { ownerWallet: "11111111111111111111111111111111" },
  { transactionBase64: "AAAA" },
  { supportedTransactionVersions: [0, 0] },
])("rejects untrusted mint input %j", (change) => {
  expect(artworkMintRequestSchema.safeParse({ ...request, ...change }).success).toBe(
    false,
  );
});

it("requires an explicit publication confirmation with exact optimistic concurrency", () => {
  const input = {
    expectedUpdatedAt: request.expectedUpdatedAt,
    publicationConfirmed: true,
  };
  expect(artworkPublicationRequestSchema.parse(input)).toEqual(input);
  for (const change of [
    { publicationConfirmed: false },
    { expectedUpdatedAt: "stale" },
    { notes: "private" },
    { wallet: "forged" },
  ])
    expect(
      artworkPublicationRequestSchema.safeParse({ ...input, ...change }).success,
    ).toBe(false);
});
