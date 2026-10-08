import type { ResaleInspectionReview } from "@katha/shared";
export function resaleFixture(
  ownerWallet = "11111111111111111111111111111112",
  kathaId = "KATHA-PAUBHA-000001",
): ResaleInspectionReview {
  return {
    kathaId,
    title: "Synthetic resale artwork",
    cluster: "localnet",
    ownerWallet,
    custodyState: "KATHA_HELD",
    custodyRevision: "1",
    chainTime: "1790000000",
    secondary: true,
    canList: true,
    canRequest: false,
    inspection: {
      status: "NOT_REQUIRED",
      report: "11111111111111111111111111111114",
      hash: "a".repeat(64),
      version: 1,
      inspectedAt: "1789000000",
      validUntil: null,
    },
    requests: [],
  };
}
