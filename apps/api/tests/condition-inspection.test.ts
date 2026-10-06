import { expect, it, vi } from "vitest";
import { conditionInspectionReviewSchema } from "@katha/shared";
import { createConditionAttestation } from "../src/condition-attestation.js";
import { conditionFixture } from "./fixtures/condition-attestation.js";
import { createApi } from "../src/app.js";
import {
  getCustodyHeadDecoder,
  getCustodyHeadEncoder,
  CustodyState,
} from "@katha/solana/registry";
it.each(["initial", "unminted", "minted"] as const)(
  "reads a protected, verified %s inspection scope",
  async (mode) => {
    const f = await conditionFixture(mode);
    const page = await f.service.review("Bearer synthetic", f.document.kathaId);
    conditionInspectionReviewSchema.parse(page);
    expect(page.chain.version).toBe(mode === "initial" ? 0 : 1);
    expect(page.chain.scope).toEqual(f.document.scope ?? null);
    expect(page.report?.canonicalDocument).toBe(new TextDecoder().decode(f.bytes));
    expect(page.report?.documentHash).toBe(f.hash);
    expect(JSON.stringify(page)).not.toContain("storageKey");
    expect(page.chain.allowedReasons).toContain(f.document.reason);
  },
);
it.each([undefined, "Bearer outsider"])(
  "denies inspection review before any private read",
  async (token) => {
    const f = await conditionFixture();
    await expect(f.service.review(token, f.document.kathaId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(f.load).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  },
);
it("withholds another verifier's private report", async () => {
  const f = await conditionFixture();
  f.snapshot.report!.authorityWallet = "11111111111111111111111111111112";
  const page = await f.service.review("Bearer synthetic", f.document.kathaId);
  expect(page.report).toBeNull();
  expect(f.read).not.toHaveBeenCalled();
});
it.each(["hash", "bytes", "owner", "custody", "head", "unverified"])(
  "rejects forged review %s",
  async (kind) => {
    const f = await conditionFixture("minted");
    if (kind === "hash") f.snapshot.report!.documentHash = "f".repeat(64);
    if (kind === "bytes") f.read.mockResolvedValueOnce(new Uint8Array([1]));
    if (kind === "owner")
      f.accounts.assetAccount = {
        exists: false,
        address: f.accounts.assetAccount.address,
      };
    if (kind === "custody" && f.accounts.custodyHeadAccount.exists) {
      const decoded = getCustodyHeadDecoder().decode(
        f.accounts.custodyHeadAccount.data,
      );
      f.accounts.custodyHeadAccount = {
        ...f.accounts.custodyHeadAccount,
        data: Uint8Array.from(
          getCustodyHeadEncoder().encode({ ...decoded, revision: 2n }),
        ),
      };
    }
    if (kind === "head") f.accounts.currentReportAccount = null;
    if (kind === "unverified") f.snapshot.artist!.verificationStatus = "UNVERIFIED";
    await expect(
      f.service.review("Bearer synthetic", f.document.kathaId),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  },
);
it("supports collector-held scope without changing custody", async () => {
  const f = await conditionFixture("minted");
  if (!f.accounts.custodyHeadAccount.exists) throw Error();
  const state = getCustodyHeadDecoder().decode(f.accounts.custodyHeadAccount.data);
  f.accounts.custodyHeadAccount = {
    ...f.accounts.custodyHeadAccount,
    data: Uint8Array.from(
      getCustodyHeadEncoder().encode({ ...state, state: CustodyState.CollectorHeld }),
    ),
  };
  expect(
    (await f.service.review("Bearer synthetic", f.document.kathaId)).chain.scope
      ?.custodyState,
  ).toBe("COLLECTOR_HELD");
});
async function boundary() {
  const f = await conditionFixture();
  const documents = {
    metadata: vi.fn(),
    condition: vi.fn(async () => ({
      id: f.document.reportId,
      kathaId: f.document.kathaId,
      version: 1,
      status: "PREPARED" as const,
      documentHash: f.hash,
      uri: null,
    })),
  };
  const evidence = { read: vi.fn(), upload: vi.fn(), update: vi.fn() };
  const readStatus = vi.fn(async () => ({
    finalized: false,
    unresolved: false,
    receipt: null,
  }));
  const service = createConditionAttestation(
    f.store,
    f.authorization,
    f.readChain,
    f.chain,
    f.storage,
    "localnet",
    { documents, evidence, readStatus },
  );
  const { kathaId, verifierWallet, mediaHashes, ...fields } = f.document;
  f.snapshot.media.push({
    id: f.document.inspectorId,
    artworkId: f.snapshot.artwork.id,
    kind: "IMAGE",
    role: "CONDITION",
    visibility: "PRIVATE",
    position: 0,
    mimeType: "image/png",
    byteSize: 67n,
    contentHash: "a".repeat(64),
    storageKey: `private/${"a".repeat(64)}.png`,
    altText: null,
    caption: null,
    createdAt: f.snapshot.artwork.updatedAt,
    updatedAt: f.snapshot.artwork.updatedAt,
  });
  expect(verifierWallet).toBe(f.session.walletAddress);
  expect(mediaHashes).toHaveLength(1);
  const input = {
    ...fields,
    expectedUpdatedAt: f.request.expectedUpdatedAt,
    mediaIds: [f.document.inspectorId],
  };
  return { ...f, documents, evidence, readStatus, service, input, kathaId };
}
it("prepares the reviewed private document through the existing canonical boundary", async () => {
  const f = await boundary();
  await f.service.prepareDocument("Bearer synthetic", f.kathaId, f.input);
  expect(f.documents.condition).toHaveBeenCalledWith(f.kathaId, f.input, f.session);
});
it.each(["unknown", "timestamp", "reason", "scope"])(
  "rejects %s before saving a new report",
  async (reason) => {
    const f = await boundary();
    if (reason === "unknown") f.snapshot.unresolved = true;
    if (reason === "timestamp") f.input.expectedUpdatedAt = "2026-10-01T00:00:00.000Z";
    if (reason === "reason") f.input.reason = "PRE_RESALE";
    if (reason === "scope")
      f.input.scope = {
        ownerWallet: f.session.walletAddress,
        custodyRevision: 1,
        custodyState: "KATHA_HELD",
      };
    await expect(
      f.service.prepareDocument("Bearer synthetic", f.kathaId, f.input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.documents.condition).not.toHaveBeenCalled();
  },
);
it("appends only private image evidence and rejects public or stale uploads", async () => {
  const f = await boundary();
  const input = {
    expectedUpdatedAt: f.input.expectedUpdatedAt,
    role: "CONDITION",
    visibility: "PRIVATE",
    mimeType: "image/png",
    altText: null,
    caption: null,
    approvedPublic: false,
  };
  const bytes = new Uint8Array([1]);
  await f.service.uploadEvidence("Bearer synthetic", f.kathaId, input, bytes);
  expect(f.evidence.upload).toHaveBeenCalledWith(f.kathaId, input, bytes);
  f.evidence.upload.mockClear();
  await expect(
    f.service.uploadEvidence(
      "Bearer synthetic",
      f.kathaId,
      { ...input, visibility: "PUBLIC", approvedPublic: true },
      bytes,
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  f.snapshot.unresolved = true;
  await expect(
    f.service.uploadEvidence("Bearer synthetic", f.kathaId, input, bytes),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.evidence.upload).not.toHaveBeenCalled();
});
it("does not reprepare an already finalized report receipt", async () => {
  const f = await boundary();
  f.readStatus.mockResolvedValue({ finalized: true, unresolved: false, receipt: null });
  await expect(
    f.service.prepare("Bearer synthetic", f.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).not.toHaveBeenCalled();
});
it("strict protected review route rejects extra query and redacts unauthorized reads", async () => {
  const f = await conditionFixture();
  const app = createApi(
    undefined,
    undefined,
    undefined,
    undefined,
    f.authorization,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.service,
  );
  const path = `/verifier/artworks/${f.document.kathaId}/condition`;
  expect((await app.request(path)).status).toBe(401);
  const response = await app.request(path, {
    headers: { Authorization: "Bearer synthetic" },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(
    (
      await app.request(`${path}?private=true`, {
        headers: { Authorization: "Bearer synthetic" },
      })
    ).status,
  ).toBe(400);
});

it("rejects evidence outside the reviewed private image list", async () => {
  const f = await boundary();
  f.input.mediaIds = [f.snapshot.artwork.id];
  await expect(
    f.service.prepareDocument("Bearer synthetic", f.kathaId, f.input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.documents.condition).not.toHaveBeenCalled();
});
