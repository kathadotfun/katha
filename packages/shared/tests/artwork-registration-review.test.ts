import { expect, it } from "vitest";
import {
  registrationIdentitySchema,
  registrationStatusSchema,
} from "../src/artwork-registration-review.js";
it("rejects privileged identity fields and non-finalized indexing claims", () => {
  expect(
    registrationIdentitySchema.safeParse({
      artistId: "aaaaaaaa-1111-4111-8111-111111111111",
      creatorWallet: null,
      category: "PAUBHA",
      creationYear: 2026,
      authorshipEvidenceHash: "e".repeat(64),
    }).success,
  ).toBe(true);
  expect(registrationIdentitySchema.safeParse({ owner: "forged" }).success).toBe(false);
  expect(
    registrationStatusSchema.safeParse({
      finalized: false,
      unresolved: true,
      receipt: {
        status: "UNKNOWN",
        signature: "3".repeat(88),
        slot: null,
        indexed: true,
      },
    }).success,
  ).toBe(false);
  expect(
    registrationStatusSchema.safeParse({
      finalized: true,
      unresolved: false,
      receipt: null,
      signedWire: "private",
    }).success,
  ).toBe(false);
});
it("verification review keeps receipt state separate and excludes private inspection fields", async () => {
  const { artworkVerificationReviewSchema } =
    await import("../src/artwork-registration-review.js");
  const review = {
    kathaId: "KATHA-PAUBHA-000001",
    cluster: "localnet",
    updatedAt: "2026-10-06T00:00:00.000Z",
    title: "Synthetic artwork",
    identity: null,
    artistVerified: true,
    published: false,
    metadata: null,
    registration: { finalized: true, unresolved: false, receipt: null },
    verification: {
      finalized: false,
      unresolved: true,
      receipt: {
        status: "UNKNOWN",
        signature: "3".repeat(88),
        slot: null,
        indexed: false,
      },
    },
  };
  expect(artworkVerificationReviewSchema.safeParse(review).success).toBe(true);
  for (const field of [
    "inspectionNotes",
    "evidenceBytes",
    "payoutWallet",
    "signedWire",
    "bearerToken",
  ])
    expect(
      artworkVerificationReviewSchema.safeParse({ ...review, [field]: "PRIVATE" })
        .success,
    ).toBe(false);
  expect(
    artworkVerificationReviewSchema.safeParse({
      ...review,
      verification: {
        ...review.verification,
        receipt: { ...review.verification.receipt, indexed: true },
      },
    }).success,
  ).toBe(false);
});
