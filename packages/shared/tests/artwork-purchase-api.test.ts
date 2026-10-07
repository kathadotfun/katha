import { expect, it } from "vitest";
import {
  purchaseQuoteRequestSchema,
  purchasePrepareRequestSchema,
  chainOperationKindSchema,
} from "../src/index.js";
const request = { supportedTransactionVersions: [0, 1] };
it("accepts wallet versions for quote and binds purchase to a hash and idempotency key", () => {
  expect(purchaseQuoteRequestSchema.parse(request)).toEqual(request);
  expect(
    purchasePrepareRequestSchema.parse({
      ...request,
      quoteHash: "a".repeat(64),
      idempotencyKey: "purchase-001",
    }).quoteHash,
  ).toBe("a".repeat(64));
  expect(chainOperationKindSchema.parse("PURCHASE_ARTWORK")).toBe("PURCHASE_ARTWORK");
});
it.each([
  { buyer: "client" },
  { paymentMint: "client" },
  { price: "100" },
  { distribution: {} },
  { supportedTransactionVersions: [2] },
])("rejects client-selected quote fields %#", (change) => {
  expect(purchaseQuoteRequestSchema.safeParse({ ...request, ...change }).success).toBe(
    false,
  );
});
it.each([
  { quoteHash: "A".repeat(64) },
  { quoteHash: "a" },
  { idempotencyKey: "" },
  { expectedRevision: "0" },
])("rejects malformed or unreviewed purchase %#", (change) => {
  expect(
    purchasePrepareRequestSchema.safeParse({
      ...request,
      quoteHash: "a".repeat(64),
      idempotencyKey: "purchase-001",
      ...change,
    }).success,
  ).toBe(false);
});
