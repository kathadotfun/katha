import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createResaleInspection } from "../src/resale-inspection.js";
import { conditionFixture } from "./fixtures/condition-attestation.js";
import { DomainError } from "../src/errors.js";
import type { ResaleInspectionStore } from "@katha/db";
import type { MarketplaceListingReader } from "@katha/solana";
import {
  getKathaConfigDecoder,
  getCustodyHeadDecoder,
  getCustodyHeadEncoder,
  CustodyState,
  getConditionAttestationDecoder,
  getConditionAttestationEncoder,
  ConditionReason,
} from "@katha/solana/registry";
import { getMarketplaceConfigEncoder, ListingStatus } from "@katha/solana/marketplace";
async function fixture() {
  const f = await conditionFixture("minted");
  const wallet = getKathaConfigDecoder().decode(
    f.accounts.configAccount.data,
  ).verifierAuthority;
  if (!f.accounts.custodyHeadAccount.exists || !f.accounts.currentReportAccount)
    throw new Error("Missing synthetic accounts");
  f.accounts.custodyHeadAccount = {
    ...f.accounts.custodyHeadAccount,
    data: Uint8Array.from(
      getCustodyHeadEncoder().encode({
        ...getCustodyHeadDecoder().decode(f.accounts.custodyHeadAccount.data),
        state: CustodyState.CollectorHeld,
        subject: wallet,
      }),
    ),
  };
  const previous = getConditionAttestationDecoder().decode(
    f.accounts.currentReportAccount.data,
  );
  f.accounts.currentReportAccount = {
    ...f.accounts.currentReportAccount,
    data: Uint8Array.from(
      getConditionAttestationEncoder().encode({
        ...previous,
        inspectedAt: f.accounts.currentUnixTimestamp - 60n,
        recordedAt: f.accounts.currentUnixTimestamp - 60n,
        reason: ConditionReason.PreResale,
        ownerScope: wallet,
        custodyRevisionScope: 1n,
      }),
    ),
  };
  const market = {
    accounts: {
      ...f.accounts,
      marketplaceConfigAccount: {
        data: Uint8Array.from(
          getMarketplaceConfigEncoder().encode({
            version: 1,
            authority: wallet,
            registryConfig: f.accounts.configAccount.address,
            registryProgram: f.accounts.configAccount.programAddress,
            tokenProgram: f.accounts.artworkAccount.address,
            paymentDecimals: 6,
            collection: f.accounts.artworkAccount.address,
            paymentMint: f.accounts.artworkAccount.address,
            treasury: wallet,
            commissionBps: 250,
            secondaryRoyaltyBps: 500,
            inspectionValiditySeconds: 2592000n,
            bump: 1,
          }),
        ),
      },
    },
    state: {
      owner: f.session.walletAddress,
      artistId: f.snapshot.artwork.artistId,
      ledger: { status: ListingStatus.Purchased, completedSales: 1n },
    },
    chainTime: f.accounts.currentUnixTimestamp,
  } as unknown as Awaited<ReturnType<MarketplaceListingReader>>;
  const load = vi.fn(async () => f.snapshot.artwork),
    list = vi.fn(async () => []),
    request = vi.fn<ResaleInspectionStore["request"]>(
      async (_art, ownerWallet, custodyRevision, conditionVersion, id) => ({
        id,
        artworkId: f.snapshot.artwork.id,
        ownerWallet,
        custodyRevision,
        conditionVersion,
        requestedAt: new Date(),
      }),
    );
  const sessions = {
    authenticate: async (bearer: string | undefined) => {
      if (bearer !== "Bearer synthetic") throw new DomainError("UNAUTHENTICATED");
      return f.session;
    },
  };
  const service = createResaleInspection(
    { load, list, request },
    sessions,
    f.authorization,
    async () => f.accounts,
    async () => market,
    "localnet",
  );
  return { ...f, market, service, load, list, request };
}
it("observes only finalized owner/custody-scoped inspection approval", async () => {
  const f = await fixture();
  const page = await f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId);
  expect(page.inspection.status).toBe("APPROVED");
  expect(page.canList).toBe(true);
  expect(JSON.stringify(page)).not.toContain("PRIVATE");
  expect(f.list).toHaveBeenCalledWith(f.snapshot.artwork.id, f.session.walletAddress);
});
it.each(["expired", "reason", "scope", "verifier", "custody"])(
  "blocks resale on %s approval",
  async (failure) => {
    const f = await fixture();
    const account = f.accounts.currentReportAccount!;
    const report = getConditionAttestationDecoder().decode(account.data);
    if (failure === "expired") f.market.chainTime += 2592001n;
    if (failure === "reason") report.reason = ConditionReason.PostDelivery;
    if (failure === "scope")
      report.ownerScope = {
        __option: "Some",
        value: f.accounts.artworkAccount.address,
      };
    if (failure === "verifier") report.verifier = f.accounts.artworkAccount.address;
    if (failure === "custody")
      report.custodyRevisionScope = { __option: "Some", value: 2n };
    f.accounts.currentReportAccount = {
      ...account,
      data: Uint8Array.from(getConditionAttestationEncoder().encode(report)),
    };
    const page = await f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId);
    expect(page.canList).toBe(false);
    expect(page.inspection.status).not.toBe("APPROVED");
  },
);
it("request persists coordination without changing condition or simulating a transaction", async () => {
  const f = await fixture();
  const before = structuredClone(f.accounts);
  await f.service.request("Bearer synthetic", f.snapshot.artwork.kathaId, {
    requestId: randomUUID(),
    expectedConditionVersion: 1,
    expectedCustodyRevision: "1",
    inspectionRequested: true,
  });
  expect(f.request).toHaveBeenCalledOnce();
  expect(f.accounts).toEqual(before);
  expect(f.simulate).not.toHaveBeenCalled();
});
it.each(["owner", "revision", "condition", "confirmation", "grade", "primary"])(
  "rejects forged inspection request %s",
  async (failure) => {
    const f = await fixture();
    if (failure === "owner")
      f.session.walletAddress = f.accounts.artworkAccount.address;
    if (failure === "primary") f.market.state.ledger!.completedSales = 0n;
    await expect(
      f.service.request("Bearer synthetic", f.snapshot.artwork.kathaId, {
        requestId: randomUUID(),
        expectedConditionVersion: failure === "condition" ? 2 : 1,
        expectedCustodyRevision: failure === "revision" ? "2" : "1",
        inspectionRequested: failure !== "confirmation",
        ...(failure === "grade" ? { grade: "GOOD" } : {}),
      }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(f.request).not.toHaveBeenCalled();
  },
);
it("unauthenticated requests and changed chain observations cannot expose private requests", async () => {
  const f = await fixture();
  await expect(
    f.service.review(undefined, f.snapshot.artwork.kathaId),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.load).not.toHaveBeenCalled();
  f.market.state.owner = f.accounts.artworkAccount.address;
  await expect(
    f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.list).not.toHaveBeenCalled();
});
it("requires configured verifier authority before reviewing the operator request queue", async () => {
  const f = await fixture();
  f.authorities.verifierAuthority = f.accounts.artworkAccount.address;
  await expect(
    f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId, true),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.list).not.toHaveBeenCalled();
});
it("inspection endpoints reject forged claims and protect review responses from caching", async () => {
  const f = await fixture();
  const { createApi } = await import("../src/app.js");
  const args: Parameters<typeof createApi> = [];
  args[4] = f.authorization;
  args[25] = f.service;
  const app = createApi(...args);
  const path = `/resale/artworks/${f.snapshot.artwork.kathaId}`,
    headers = { Authorization: "Bearer synthetic" };
  const response = await app.request(path, { headers });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(path + "?grade=GOOD", { headers })).status).toBe(400);
  const forged = await app.request(path, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      expectedCustodyRevision: "1",
      expectedConditionVersion: 1,
      inspectionRequested: true,
      status: "APPROVED",
    }),
  });
  expect(forged.status).toBe(400);
  expect(f.request).not.toHaveBeenCalled();
  const privateQueue = await app.request(
    `/verifier/artworks/${f.snapshot.artwork.kathaId}/resale`,
    { headers },
  );
  expect(privateQueue.status).toBe(200);
  expect(privateQueue.headers.get("Cache-Control")).toBe("no-store");
});
