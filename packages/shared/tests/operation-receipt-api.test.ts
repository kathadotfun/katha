import { expect, it } from "vitest";
import {
  operationReceiptRequestSchema,
  operationReceiptResponseSchema,
  operationReceiptParamsSchema,
} from "../src/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const request = { preparationId: id, transactionBase64: "AAAA" };
it("accepts a bounded signed transport request and UUID path", () => {
  operationReceiptRequestSchema.parse(request);
  operationReceiptParamsSchema.parse({ operationId: id });
});
it.each([
  { preparationId: "invalid" },
  { transactionBase64: "a" },
  { transactionBase64: "a".repeat(5468) },
  { cluster: "devnet" },
  { status: "FINALIZED" },
  { slot: "1" },
])("rejects untrusted receipt fields %j", (change) => {
  expect(
    operationReceiptRequestSchema.safeParse({ ...request, ...change }).success,
  ).toBe(false);
});
const unknown = {
  receiptId: id,
  operationId: id,
  preparationId: id,
  kind: "MINT_ARTWORK",
  cluster: "localnet",
  signature: "2".repeat(88),
  messageHash: "a".repeat(64),
  status: "UNKNOWN",
  operationStatus: "UNKNOWN",
  failureCode: null,
  slot: null,
  chainRecordedAt: null,
};
it("projects unknown and precise finalized slots", () => {
  operationReceiptResponseSchema.parse(unknown);
  operationReceiptResponseSchema.parse({
    ...unknown,
    status: "FINALIZED",
    operationStatus: "FINALIZED",
    slot: "9007199254740993",
    chainRecordedAt: "2026-10-05T00:00:00.000Z",
  });
});
it.each([
  { slot: "1" },
  { failureCode: "TRANSACTION_FAILED" },
  { status: "FINALIZED" },
  { status: "FAILED" },
])("rejects incomplete receipt outcomes %j", (change) => {
  expect(
    operationReceiptResponseSchema.safeParse({ ...unknown, ...change }).success,
  ).toBe(false);
});
