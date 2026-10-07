import { expect, it } from "vitest";
import {
  listingCreateRequestSchema,
  listingCancelRequestSchema,
  chainOperationKindSchema,
  registryOperationKindSchema,
} from "../src/index.js";
const request = {
  idempotencyKey: "listing-test",
  expectedRevision: "0",
  price: "100000000",
  expiresAt: "1800003600",
  supportedTransactionVersions: [0, 1],
};
it("accepts exact decimal strings and distinct listing/cancellation contracts", () => {
  expect(listingCreateRequestSchema.parse(request)).toEqual(request);
  expect(
    listingCancelRequestSchema.parse({
      idempotencyKey: request.idempotencyKey,
      expectedRevision: "1",
      supportedTransactionVersions: [0],
    }).expectedRevision,
  ).toBe("1");
  expect(chainOperationKindSchema.parse("CREATE_LISTING")).toBe("CREATE_LISTING");
  expect(chainOperationKindSchema.parse("CANCEL_LISTING")).toBe("CANCEL_LISTING");
  expect(chainOperationKindSchema.safeParse("PURCHASE_ARTWORK").success).toBe(false);
  expect(registryOperationKindSchema.safeParse("CREATE_LISTING").success).toBe(false);
});
it.each([
  { expectedRevision: "18446744073709551615" },
  { expectedRevision: "01" },
  { expectedRevision: -1 },
  { price: "0" },
  { price: "1.5" },
  { price: 100 },
  { price: "18446744073709551616" },
  { expiresAt: "0" },
  { expiresAt: "9223372036854775808" },
  { expiresAt: 1800003600 },
  { supportedTransactionVersions: [2] },
  { seller: "client-selected" },
])("rejects malformed or client-controlled listing input %#", (change) => {
  expect(listingCreateRequestSchema.safeParse({ ...request, ...change }).success).toBe(
    false,
  );
});
it("does not accept price/expiry fields for cancellation", () => {
  expect(listingCancelRequestSchema.safeParse(request).success).toBe(false);
});
