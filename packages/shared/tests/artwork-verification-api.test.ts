import { expect, it } from "vitest";
import { artworkVerificationRequestSchema } from "../src/artwork-verification-api.js";
const request = {
  authenticityConfirmed: true,
  idempotencyKey: "register_1",
  expectedUpdatedAt: "2026-10-05T00:00:00.000Z",
  metadataVersionId: "11111111-1111-4111-8111-111111111111",
  supportedTransactionVersions: [0, 1],
};
it("accepts bounded verification intent with explicit wallet capabilities", () => {
  expect(artworkVerificationRequestSchema.parse(request)).toEqual(request);
});
it.each([
  { ...request, authenticityConfirmed: false },
  { ...request, authenticityConfirmed: undefined },
  { ...request, metadataHash: "a".repeat(64) },
  { ...request, authorityWallet: "client" },
  { ...request, idempotencyKey: "spaces invalid" },
  { ...request, expectedUpdatedAt: "2026-10-05T00:00:00Z" },
  { ...request, metadataVersionId: "invalid" },
  { ...request, supportedTransactionVersions: [] },
  { ...request, supportedTransactionVersions: [0, 0] },
  { ...request, supportedTransactionVersions: ["legacy"] },
])("rejects untrusted or malformed request fields", (value) => {
  expect(artworkVerificationRequestSchema.safeParse(value).success).toBe(false);
});
