import { expect, it } from "vitest";
import { conditionAttestationRequestSchema } from "../src/condition-attestation-api.js";
import { conditionReportDocumentSchema } from "../src/condition-report.js";
const request = {
  idempotencyKey: "condition_1",
  expectedUpdatedAt: "2026-10-05T00:00:00.000Z",
  reportId: "11111111-1111-4111-8111-111111111111",
  supportedTransactionVersions: [0, 1],
  expectedConditionVersion: 0,
};
it("accepts explicit reviewed report identity and zero initial version", () =>
  expect(conditionAttestationRequestSchema.parse(request)).toEqual(request));
it.each([
  { ...request, reportHash: "a".repeat(64) },
  { ...request, expectedConditionVersion: -1 },
  { ...request, expectedConditionVersion: 4294967295 },
  { ...request, supportedTransactionVersions: [0, 0] },
  { ...request, authorityWallet: "caller" },
  { ...request, ownerWallet: "caller" },
  { ...request, reportId: "bad" },
])("rejects caller hashes/accounts and invalid versions", (input) =>
  expect(conditionAttestationRequestSchema.safeParse(input).success).toBe(false),
);
it("bounds exact minted report scope while preserving old unscoped documents", () => {
  const scope = conditionReportDocumentSchema.shape.scope;
  expect(scope.safeParse(undefined).success).toBe(true);
  expect(
    scope.safeParse({
      ownerWallet: "11111111111111111111111111111111",
      custodyRevision: 1,
      custodyState: "KATHA_HELD",
    }).success,
  ).toBe(true);
  for (const custodyRevision of [0, 4294967296])
    expect(
      scope.safeParse({
        ownerWallet: "11111111111111111111111111111111",
        custodyRevision,
        custodyState: "COLLECTOR_HELD",
      }).success,
    ).toBe(false);
});
