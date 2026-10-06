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
