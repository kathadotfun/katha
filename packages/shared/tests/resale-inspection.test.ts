import { expect, it } from "vitest";
import { resaleInspectionRequestSchema } from "../src/index.js";
const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  expectedCustodyRevision: "2",
  expectedConditionVersion: 1,
  inspectionRequested: true,
};
it("accepts a scoped coordination request with no collector condition authority", () => {
  expect(resaleInspectionRequestSchema.parse(request).inspectionRequested).toBe(true);
});
it.each([
  { grade: "GOOD" },
  { inspectionRequested: false },
  { expectedCustodyRevision: "01" },
  { expectedConditionVersion: 0 },
  { ownerWallet: "11111111111111111111111111111112" },
  { status: "APPROVED" },
])("rejects forged or malformed inspection request %j", (change) => {
  expect(
    resaleInspectionRequestSchema.safeParse({ ...request, ...change }).success,
  ).toBe(false);
});
