import { expect, it } from "vitest";
import { conditionInspectionReviewSchema } from "../src/index.js";
const review = {
  kathaId: "KATHA-PAUBHA-000001",
  title: "Synthetic artwork",
  updatedAt: "2026-10-05T00:00:00.000Z",
  cluster: "localnet",
  chain: {
    version: 0,
    minted: false,
    scope: null,
    observedAt: "2026-10-05T00:00:00.000Z",
    allowedReasons: ["INITIAL_VERIFICATION"],
  },
  media: [],
  report: null,
  attestation: { finalized: false, unresolved: false, receipt: null },
  unresolved: false,
};
it("accepts a protected initial review without publishing storage references", () => {
  expect(conditionInspectionReviewSchema.parse(review)).toEqual(review);
});
it.each([
  { ...review, storageKey: "private/evidence.png" },
  { ...review, chain: { ...review.chain, minted: true } },
  {
    ...review,
    media: [
      {
        id: "bad",
        contentHash: "a".repeat(64),
        mimeType: "application/pdf",
        byteSize: "1",
      },
    ],
  },
])("rejects malformed or inconsistent protected responses", (value) => {
  expect(conditionInspectionReviewSchema.safeParse(value).success).toBe(false);
});
it("keeps minted owner and custody scope separate from report status", () => {
  const scope = {
    ownerWallet: "11111111111111111111111111111112",
    custodyRevision: 1,
    custodyState: "COLLECTOR_HELD",
  };
  expect(
    conditionInspectionReviewSchema.parse({
      ...review,
      chain: {
        ...review.chain,
        version: 1,
        minted: true,
        scope,
        allowedReasons: ["PRE_RESALE"],
      },
    }).chain.scope,
  ).toEqual(scope);
});
