import { expect, it } from "vitest";
import {
  custodyPreparationRequestSchema,
  fulfillmentCreateRequestSchema,
  fulfillmentUpdateRequestSchema,
} from "../src/index.js";
const custody = {
  idempotencyKey: "test",
  expectedUpdatedAt: "2026-10-05T00:00:00.000Z",
  expectedCustodyRevision: "0",
  transition: { action: "ATTEST_KATHA_CUSTODY", from: "UNKNOWN", to: "KATHA_HELD" },
  collectorWallet: null,
  movementConfirmed: true,
  supportedTransactionVersions: [0],
};
it("accepts exact custody revisions and explicit manual confirmation", () => {
  expect(custodyPreparationRequestSchema.parse(custody).expectedCustodyRevision).toBe(
    "0",
  );
});
it.each(["01", "-1", "1.2", "18446744073709551615"])(
  "rejects non-advancing revision %s",
  (revision) => {
    expect(
      custodyPreparationRequestSchema.safeParse({
        ...custody,
        expectedCustodyRevision: revision,
      }).success,
    ).toBe(false);
  },
);
it.each([
  { movementConfirmed: false },
  { transition: { action: "DISPATCH_FROM_KATHA", from: "UNKNOWN", to: "IN_TRANSIT" } },
  { transactionBase64: "AAAA" },
  { expectedCustodyRevision: 1 },
])("rejects invalid custody intent %j", (change) => {
  expect(
    custodyPreparationRequestSchema.safeParse({ ...custody, ...change }).success,
  ).toBe(false);
});
const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  kind: "DELIVERY",
  recipientName: "Synthetic",
  contactEmail: "synthetic@example.invalid",
  contactPhone: null,
  addressLines: ["Synthetic"],
  city: "Synthetic",
  region: null,
  postalCode: null,
  countryCode: "NP",
  deliveryInstructions: null,
};
it("accepts bounded private requests and strict admin updates", () => {
  expect(fulfillmentCreateRequestSchema.parse(request).kind).toBe("DELIVERY");
  expect(
    fulfillmentUpdateRequestSchema.safeParse({
      expectedUpdatedAt: custody.expectedUpdatedAt,
      status: "APPROVED",
      manualConfirmation: true,
    }).success,
  ).toBe(true);
});
it.each([
  { contactEmail: null },
  { addressLines: [] },
  { countryCode: "np" },
  { recipientName: "  " },
  { requesterWallet: "11111111111111111111111111111111" },
  { status: "RECEIVED" },
])("rejects malformed/private authority input %j", (change) => {
  expect(
    fulfillmentCreateRequestSchema.safeParse({ ...request, ...change }).success,
  ).toBe(false);
});
