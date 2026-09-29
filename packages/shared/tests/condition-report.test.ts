import { describe, expect, it } from "vitest";

import {
  conditionGradeSchema,
  conditionReasonSchema,
  conditionReportCommitmentSchema,
  conditionReportDocumentSchema,
} from "../src/condition-report.js";

const reportId = "5e3db4cb-19b2-4a50-9aeb-107a439b51ca";
const inspectorId = "4740ea06-7cfa-4d6a-b20a-c7ddc848f677";
const kathaId = "KATHA-PAUBHA-000001";
const mediaHash = "a".repeat(64);

const validDocument = () => ({
  reportId,
  kathaId,
  grade: "GOOD",
  reason: "INITIAL_VERIFICATION",
  inspectorId,
  verifierWallet: "11111111111111111111111111111111",
  inspectedAt: "2025-06-15T09:30:00.000Z",
  reportedAt: "2025-06-15T10:00:00.000Z",
  notes: "Minor age-consistent surface wear.",
  mediaHashes: [mediaHash],
});

describe("condition vocabulary", () => {
  it.each(["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"])(
    "accepts grade %s",
    (grade) => {
      expect(conditionGradeSchema.parse(grade)).toBe(grade);
    },
  );

  it.each([
    "INITIAL_VERIFICATION",
    "PRE_SALE",
    "POST_DELIVERY",
    "PRE_RESALE",
    "RETURN_TO_CUSTODY",
    "INSURANCE",
  ])("accepts reason %s", (reason) => {
    expect(conditionReasonSchema.parse(reason)).toBe(reason);
  });

  it.each(["PRISTINE", "UNKNOWN", "VERIFIED", "", null])(
    "rejects grade %s",
    (grade) => {
      expect(conditionGradeSchema.safeParse(grade).success).toBe(false);
    },
  );

  it.each(["RESALE_APPROVED", "LISTED", "", null])("rejects reason %s", (reason) => {
    expect(conditionReasonSchema.safeParse(reason).success).toBe(false);
  });
});

describe("condition report document", () => {
  it("accepts a report with independent inspector and verifier identifiers", () => {
    const report = conditionReportDocumentSchema.parse(validDocument());
    expect(report.reportId).toBe(reportId);
    expect(report.inspectorId).toBe(inspectorId);
    expect(report.verifierWallet).toBe("11111111111111111111111111111111");
  });

  it("allows documentation at the inspection instant", () => {
    const report = validDocument();
    expect(
      conditionReportDocumentSchema.safeParse({
        ...report,
        reportedAt: report.inspectedAt,
      }).success,
    ).toBe(true);
  });

  it.each([
    { reportId: "not-a-report-id" },
    { kathaId: "KATHA-PAUBHA-000000" },
    { inspectorId: "not-an-inspector-id" },
    { verifierWallet: "not-a-wallet" },
    { grade: "LISTED" },
    { reason: "RESALE_APPROVED" },
    { notes: "   " },
    { mediaHashes: [] },
    { mediaHashes: ["A".repeat(64)] },
    { mediaHashes: [mediaHash, mediaHash] },
    { inspectedAt: "2025-06-15T09:30:00+05:45" },
    { inspectedAt: "2025-06-15T09:30:00Z" },
    { inspectedAt: "2025-02-30T09:30:00.000Z" },
    { reportedAt: "2025-06-15T09:29:59.999Z" },
  ])("rejects malformed report field %#", (change) => {
    expect(
      conditionReportDocumentSchema.safeParse({ ...validDocument(), ...change })
        .success,
    ).toBe(false);
  });

  it("rejects unlisted private fields", () => {
    expect(
      conditionReportDocumentSchema.safeParse({
        ...validDocument(),
        shippingAddress: "private",
      }).success,
    ).toBe(false);
  });
});

describe("condition report commitment", () => {
  it("stores the external document hash with the same report identity", () => {
    expect(
      conditionReportCommitmentSchema.parse({
        reportId,
        kathaId,
        reportHash: "b".repeat(64),
      }).reportId,
    ).toBe(reportId);
  });

  it.each([
    { reportId: "not-a-report-id" },
    { kathaId: "KATHA-PAUBHA-000000" },
    { privatePhotoUrl: "https://example.invalid/private" },
  ])("rejects malformed or unlisted commitment field %#", (change) => {
    expect(
      conditionReportCommitmentSchema.safeParse({
        reportId,
        kathaId,
        reportHash: "b".repeat(64),
        ...change,
      }).success,
    ).toBe(false);
  });

  it.each(["b".repeat(63), "B".repeat(64), "not-a-hash"])(
    "rejects malformed hash %s",
    (reportHash) => {
      expect(
        conditionReportCommitmentSchema.safeParse({ reportId, kathaId, reportHash })
          .success,
      ).toBe(false);
    },
  );
});
