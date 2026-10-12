import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { CustodyOperationStore, FulfillmentRequestRecord } from "@katha/db";
import type { CustodyReader } from "@katha/solana";
import {
  getCustodyHeadDecoder,
  getCustodyHeadEncoder,
  CustodyState,
  getArtworkRecordDecoder,
  getKathaConfigDecoder,
  findTransitionCustodyTransitionPda,
  parseInitializeCustodyInstruction,
  parseTransitionCustodyInstruction,
} from "@katha/solana/registry";
import {
  fulfillmentResponseSchema,
  custodyAdministrationReviewSchema,
} from "@katha/shared";
import { conditionFixture } from "./fixtures/condition-attestation.js";
import { temporaryWallet } from "./fixtures/wallet.js";
import { createCustodyOperations } from "../src/custody-operations.js";
import { DomainError } from "../src/errors.js";
import { createApi } from "../src/app.js";
async function fixture(minted = false) {
  const f = await conditionFixture(minted ? "minted" : "initial");
  const [targetTransition] = await findTransitionCustodyTransitionPda({
    artwork: f.accounts.artworkAccount.address,
    nextRevision: minted ? 2n : 1n,
  });
  const accounts: Awaited<ReturnType<CustodyReader>> = {
    ...f.accounts,
    record: getArtworkRecordDecoder().decode(f.accounts.artworkAccount.data),
    configuration: getKathaConfigDecoder().decode(f.accounts.configAccount.data),
    ownerWallet: minted ? f.session.walletAddress : null,
    custodyRevision: minted ? 1n : 0n,
    custodyState: minted ? "KATHA_HELD" : "UNKNOWN",
    custodySubject: minted ? f.session.walletAddress : null,
    targetTransition,
    targetExists: false,
  };
  const input = {
    requestId: randomUUID(),
    kind: "DELIVERY" as const,
    recipientName: "Synthetic recipient",
    contactEmail: "synthetic@example.invalid",
    contactPhone: null,
    addressLines: ["Synthetic address"],
    city: "Synthetic city",
    region: null,
    postalCode: null,
    countryCode: "NP",
    deliveryInstructions: "PRIVATE INSTRUCTIONS",
  };
  const row: FulfillmentRequestRecord = {
    id: input.requestId,
    ...input,
    artworkId: f.snapshot.artwork.id,
    requesterWallet: f.session.walletAddress,
    status: "REQUESTED",
    courier: null,
    trackingReference: null,
    handledByWallet: null,
    createdAt: f.snapshot.artwork.updatedAt,
    updatedAt: f.snapshot.artwork.updatedAt,
  };
  const snapshot = {
    artwork: f.snapshot.artwork,
    request: null as FulfillmentRequestRecord | null,
  };
  const load = vi.fn<CustodyOperationStore["load"]>(async () => snapshot);
  const findRequest = vi.fn<CustodyOperationStore["findRequest"]>(async () => ({
    artwork: snapshot.artwork,
    request: { ...row, ownerReportedReceivedAt: null },
  }));
  const create = vi.fn<CustodyOperationStore["create"]>(async () => row);
  const update = vi.fn<CustodyOperationStore["update"]>(async () => ({
    ...row,
    status: "APPROVED",
    ownerReportedReceivedAt: null,
  }));
  const store: CustodyOperationStore = {
    listRequests: vi.fn(async () => ({
      items: [{ ...row, ownerReportedReceivedAt: null }],
      hasMore: false,
    })),
    hasOpenDelivery: vi.fn(async () => false),
    reportReceipt: vi.fn(async () => ({ ...row, ownerReportedReceivedAt: new Date() })),
    cancelByRequester: vi.fn(async () => ({
      ...row,
      status: "CANCELLED" as const,
      ownerReportedReceivedAt: null,
    })),
    load,
    findRequest,
    create,
    update,
    operations: () => ({ save: f.save }),
  };
  const read = vi.fn<CustodyReader>(async () => accounts);
  const sessions = {
    authenticate: async (bearer: string | undefined) => {
      if (bearer !== "Bearer synthetic") throw new DomainError("UNAUTHENTICATED");
      return f.session;
    },
  };
  const readStatus = vi.fn(async () => ({
    finalized: false,
    unresolved: false,
    receipt: null,
  }));
  const service = createCustodyOperations(
    store,
    f.authorization,
    sessions,
    read,
    f.chain,
    "localnet",
    readStatus,
  );
  const request = {
    idempotencyKey: "synthetic-custody",
    expectedUpdatedAt: snapshot.artwork.updatedAt.toISOString(),
    expectedCustodyRevision: minted ? "1" : "0",
    collectorWallet: null,
    movementConfirmed: true,
    transition: minted
      ? { action: "DISPATCH_FROM_KATHA", from: "KATHA_HELD", to: "IN_TRANSIT" }
      : { action: "ATTEST_KATHA_CUSTODY", from: "UNKNOWN", to: "KATHA_HELD" },
    supportedTransactionVersions: [0],
  };
  return {
    ...f,
    accounts,
    store,
    snapshot,
    input,
    row,
    load,
    findRequest,
    create,
    update,
    read,
    service,
    request,
    sessions,
    readStatus,
  };
}
it.each([false, true])(
  "prepares generated custody instructions, minted=%s, without physical history",
  async (minted) => {
    const f = await fixture(minted);
    const before = structuredClone(f.snapshot);
    const response = await f.service.prepare(
      "Bearer synthetic",
      f.snapshot.artwork.kathaId,
      f.request,
    );
    expect(response.kind).toBe("UPDATE_CUSTODY");
    const instruction = f.simulate.mock.calls[0]![0].instruction;
    if (minted)
      expect(parseTransitionCustodyInstruction(instruction).data.expectedRevision).toBe(
        1n,
      );
    else
      expect(
        parseInitializeCustodyInstruction(instruction).accounts.artwork.address,
      ).toBe(f.accounts.artworkAccount.address);
    expect(f.snapshot).toEqual(before);
    expect(f.update).not.toHaveBeenCalled();
  },
);
it("requires custody authority before private reads", async () => {
  const f = await fixture();
  f.authorities.custodyAuthority = temporaryWallet().address;
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
});
it.each([
  "version",
  "timestamp",
  "state",
  "occupied",
  "identity",
  "collector",
  "missing-request",
  "request-owner",
  "request-status",
  "simulation",
  "save-race",
])("rejects custody %s", async (reason) => {
  const f = await fixture(true);
  if (reason === "version") f.request.expectedCustodyRevision = "2";
  if (reason === "timestamp") f.request.expectedUpdatedAt = "2026-10-04T00:00:00.000Z";
  if (reason === "state") f.accounts.custodyState = "IN_TRANSIT";
  if (reason === "occupied") f.accounts.targetExists = true;
  if (reason === "identity") f.accounts.record.artistId = randomUUID();
  if (reason === "collector") f.request.collectorWallet = "invalid" as never;
  const input = {
    ...f.request,
    ...(reason.startsWith("request-") || reason === "missing-request"
      ? { fulfillmentId: f.row.id }
      : {}),
  };
  if (reason.startsWith("request-")) {
    f.snapshot.request = f.row;
    f.row.status = "APPROVED";
  }
  if (reason === "request-owner") f.row.requesterWallet = temporaryWallet().address;
  if (reason === "request-status") f.row.status = "REQUESTED";
  if (reason === "simulation")
    f.simulate.mockRejectedValueOnce(new Error("synthetic failure"));
  if (reason === "save-race") f.save.mockResolvedValueOnce({ status: "conflict" });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, input),
  ).rejects.toThrow();
  expect(f.update).not.toHaveBeenCalled();
});
it("binds a compatible approved fulfillment without exposing private fields in intent", async () => {
  const f = await fixture(true);
  f.row.status = "APPROVED";
  f.snapshot.request = f.row;
  await f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, {
    ...f.request,
    fulfillmentId: f.row.id,
  });
  const artifact = f.save.mock.calls[0]![3];
  expect(artifact.canonicalRequest).toContain(f.row.id);
  for (const secret of [
    f.row.recipientName,
    f.row.addressLines[0]!,
    f.row.deliveryInstructions!,
  ])
    expect(artifact.canonicalRequest).not.toContain(secret);
});
it("owner requests and private detail do not simulate or change custody", async () => {
  const f = await fixture(true);
  fulfillmentResponseSchema.parse(
    await f.service.create("Bearer synthetic", f.snapshot.artwork.kathaId, f.input),
  );
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.simulate).not.toHaveBeenCalled();
  expect(await f.service.detail("Bearer synthetic", f.row.id)).toMatchObject({
    recipientName: f.input.recipientName,
  });
});
it.each([
  "wrong-owner",
  "unminted",
  "transit",
  "wrong-return-subject",
  "wrong-cluster",
])("rejects fulfillment %s", async (reason) => {
  const f = await fixture(true);
  if (reason === "wrong-owner") f.accounts.ownerWallet = temporaryWallet().address;
  if (reason === "unminted") f.accounts.ownerWallet = null;
  if (reason === "transit") f.accounts.custodyState = "IN_TRANSIT";
  if (reason === "wrong-return-subject") {
    f.input.kind = "RETURN_TO_KATHA" as never;
    f.accounts.custodyState = "COLLECTOR_HELD";
    f.accounts.custodySubject = temporaryWallet().address;
  }
  if (reason === "wrong-cluster") f.session.cluster = "devnet";
  await expect(
    f.service.create("Bearer synthetic", f.snapshot.artwork.kathaId, f.input),
  ).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});
it("admin update rechecks live ownership and preserves custody", async () => {
  const f = await fixture(true);
  const input = {
    expectedUpdatedAt: f.row.updatedAt.toISOString(),
    status: "APPROVED",
    manualConfirmation: true,
  };
  await f.service.update("Bearer synthetic", f.row.id, input);
  expect(f.update).toHaveBeenCalledOnce();
  expect(f.save).not.toHaveBeenCalled();
  f.accounts.ownerWallet = temporaryWallet().address;
  await expect(
    f.service.update("Bearer synthetic", f.row.id, input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("does not allow a non-admin to read another request or mutate status", async () => {
  const f = await fixture(true);
  f.session.walletAddress = temporaryWallet().address;
  await expect(f.service.detail("Bearer synthetic", f.row.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    f.service.update("Bearer synthetic", f.row.id, {}),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.update).not.toHaveBeenCalled();
});
it("installs strict private no-store fulfillment and custody routes", async () => {
  const f = await fixture(true);
  const app = createApi(
    undefined,
    undefined,
    [],
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
    undefined,
    f.service,
  );
  const post = (path: string, body: unknown, method = "POST") =>
    app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer synthetic",
      },
      body: JSON.stringify(body),
    });
  const response = await post(
    `/fulfillment/artworks/${f.snapshot.artwork.kathaId}`,
    f.input,
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(
    (
      await post(
        `/fulfillment/artworks/${f.snapshot.artwork.kathaId}?private=true`,
        f.input,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await post(`/admin/artworks/${f.snapshot.artwork.kathaId}/operations/custody`, {
        ...f.request,
        status: "RECEIVED",
      })
    ).status,
  ).toBe(400);
});

it("rejects anonymous private access before database and chain reads", async () => {
  const f = await fixture(true);
  await expect(
    f.service.create(undefined, f.snapshot.artwork.kathaId, f.input),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(f.service.detail(undefined, f.row.id)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  await expect(
    f.service.prepare(undefined, f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.findRequest).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});
it("supports owner return requests and denies incomplete current collector custody", async () => {
  const f = await fixture(true);
  f.accounts.custodyState = "COLLECTOR_HELD";
  f.accounts.custodySubject = f.session.walletAddress;
  await f.service.create("Bearer synthetic", f.snapshot.artwork.kathaId, {
    ...f.input,
    kind: "RETURN_TO_KATHA",
  });
  expect(f.create).toHaveBeenCalledOnce();
});
it("redacts private infrastructure failures at the HTTP boundary", async () => {
  const f = await fixture(true);
  const app = createApi(
    undefined,
    undefined,
    [],
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
    undefined,
    f.service,
  );
  f.read.mockRejectedValueOnce(new Error("PRIVATE SHIPPING DATA"));
  const result = await app.request(
    `/fulfillment/artworks/${f.snapshot.artwork.kathaId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer synthetic",
      },
      body: JSON.stringify(f.input),
    },
  );
  expect(result.status).toBe(500);
  expect(await result.text()).not.toContain("PRIVATE SHIPPING DATA");
  expect(result.headers.get("Cache-Control")).toBe("no-store");
});

it.each([true, false])(
  "rechecks minted collector destination ownership, matching=%s",
  async (matches) => {
    const f = await fixture(true);
    const owner = temporaryWallet().address;
    f.accounts.ownerWallet = owner;
    f.accounts.custodyState = "IN_TRANSIT";
    f.accounts.custodySubject = null;
    f.accounts.custodyRevision = 2n;
    if (!f.accounts.custodyHeadAccount.exists) throw new Error("Missing fixture");
    const current = getCustodyHeadDecoder().decode(f.accounts.custodyHeadAccount.data);
    const [latestTransition] = await findTransitionCustodyTransitionPda({
      artwork: f.accounts.artworkAccount.address,
      nextRevision: 2n,
    });
    const [targetTransition] = await findTransitionCustodyTransitionPda({
      artwork: f.accounts.artworkAccount.address,
      nextRevision: 3n,
    });
    f.accounts.targetTransition = targetTransition;
    const data = new Uint8Array(115);
    data.set(
      getCustodyHeadEncoder().encode({
        ...current,
        revision: 2n,
        state: CustodyState.InTransit,
        subject: null,
        latestTransition,
      }),
    );
    f.accounts.custodyHeadAccount = { ...f.accounts.custodyHeadAccount, data };
    const input = {
      ...f.request,
      expectedCustodyRevision: "2",
      collectorWallet: matches ? owner : temporaryWallet().address,
      transition: {
        action: "RECEIVE_BY_COLLECTOR",
        from: "IN_TRANSIT",
        to: "COLLECTOR_HELD",
      },
    };
    if (matches) {
      await f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, input);
      expect(
        parseTransitionCustodyInstruction(f.simulate.mock.calls[0]![0].instruction).data
          .collector,
      ).toEqual({ __option: "Some", value: owner });
    } else {
      await expect(
        f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, input),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.simulate).not.toHaveBeenCalled();
      expect(f.save).not.toHaveBeenCalled();
    }
  },
);

it("reviews only valid chain transitions and bounded private requests", async () => {
  const f = await fixture(true);
  const result = await f.service.review(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    { limit: 20, offset: 0 },
  );
  expect(result.chain.state).toBe("KATHA_HELD");
  expect(result.transitions.map((t) => t.action)).toEqual(["DISPATCH_FROM_KATHA"]);
  expect(result.requests[0]?.allowedStatuses).toEqual(["APPROVED", "CANCELLED"]);
  expect(result.requests[0]?.transitions).toEqual([]);
  expect(result.requests[0]?.request.recipientName).toBe("Synthetic recipient");
  expect(JSON.stringify(result)).not.toContain("requesterWallet");
  expect(JSON.stringify(result)).not.toContain("handledByWallet");
  expect(f.store.listRequests).toHaveBeenCalledWith(f.snapshot.artwork.id, {
    limit: 20,
    offset: 0,
  });
  expect(f.save).not.toHaveBeenCalled();
});
it("admin review denies roles before reading private fulfillment", async () => {
  const f = await fixture();
  f.authorization.requireRole = vi.fn(async () => {
    throw new DomainError("FORBIDDEN");
  });
  await expect(
    f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId, {
      limit: 20,
      offset: 0,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.load).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.store.listRequests).not.toHaveBeenCalled();
});
it("stale requester may be cancelled but cannot authorize movement", async () => {
  const f = await fixture(true);
  f.accounts.ownerWallet = temporaryWallet().address;
  f.row.status = "APPROVED";
  const review = await f.service.review(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    { limit: 20, offset: 0 },
  );
  expect(review.requests[0]?.ownerMatches).toBe(false);
  expect(review.requests[0]?.allowedStatuses).toEqual(["CANCELLED"]);
  expect(review.requests[0]?.transitions).toEqual([]);
});
it.each(["APPROVED", "DISPATCHED"] as const)(
  "matches %s request to its physical action",
  async (status) => {
    const f = await fixture(true);
    f.row.status = status;
    if (status === "DISPATCHED") {
      f.accounts.custodyState = "IN_TRANSIT";
      f.accounts.custodySubject = null;
      f.accounts.ownerWallet = temporaryWallet().address;
      f.row.requesterWallet = f.accounts.ownerWallet;
    }
    const review = await f.service.review(
      "Bearer synthetic",
      f.snapshot.artwork.kathaId,
      { limit: 20, offset: 0 },
    );
    expect(review.requests[0]?.transitions.map((t) => t.action)).toEqual([
      status === "APPROVED" ? "DISPATCH_FROM_KATHA" : "RECEIVE_BY_COLLECTOR",
    ]);
  },
);
it("ordinary admin sees requests without Registry signing authority", async () => {
  const f = await fixture();
  f.accounts.configuration.custodyAuthority = f.accounts.artworkAccount.address;
  const review = await f.service.review(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    { limit: 20, offset: 0 },
  );
  expect(review.canAttest).toBe(false);
  expect(review.requests).toHaveLength(1);
});
it("unresolved signature rejects preparation before RPC or persistence", async () => {
  const f = await fixture();
  f.readStatus.mockResolvedValueOnce({
    finalized: false,
    unresolved: true,
    receipt: null,
  });
  await expect(
    f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.read).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
});
it("custody review route is private, paginated and validates query boundaries", async () => {
  const f = await fixture();
  const app = createApi(
    undefined,
    undefined,
    [],
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
    undefined,
    f.service,
  );
  const result = await app.request(
    `/admin/artworks/${f.snapshot.artwork.kathaId}/custody?limit=1&offset=0`,
    { headers: { Authorization: "Bearer synthetic" } },
  );
  expect(result.status).toBe(200);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(
    custodyAdministrationReviewSchema.parse(await result.json()).pagination,
  ).toEqual({
    limit: 1,
    offset: 0,
    hasMore: false,
  });
  expect(
    (
      await app.request(
        `/admin/artworks/${f.snapshot.artwork.kathaId}/custody?limit=101`,
        { headers: { Authorization: "Bearer synthetic" } },
      )
    ).status,
  ).toBe(400);
});
it("collector delivery reads are owner-scoped and reject stale owners before private reads", async () => {
  const f = await fixture(true);
  const review = await f.service.collectorReview(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    { limit: 20, offset: 0 },
  );
  expect(review.canRequest).toBe(true);
  expect(f.store.listRequests).toHaveBeenCalledWith(
    f.snapshot.artwork.id,
    { limit: 20, offset: 0 },
    f.session.walletAddress,
  );
  f.accounts.ownerWallet = temporaryWallet().address;
  vi.mocked(f.store.listRequests).mockClear();
  await expect(
    f.service.collectorReview("Bearer synthetic", f.snapshot.artwork.kathaId, {
      limit: 20,
      offset: 0,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.store.listRequests).not.toHaveBeenCalled();
});
it("owner receipt is a private report without approving custody or condition", async () => {
  const f = await fixture(true);
  f.row.status = "DISPATCHED";
  const result = await f.service.reportReceipt("Bearer synthetic", f.row.id, {
    expectedUpdatedAt: f.row.updatedAt.toISOString(),
    receiptConfirmed: true,
  });
  expect(result.status).toBe("DISPATCHED");
  expect(result.ownerReportedReceivedAt).not.toBeNull();
  expect(f.update).not.toHaveBeenCalled();
  expect(f.save).not.toHaveBeenCalled();
  expect(f.simulate).not.toHaveBeenCalled();
});
it.each(["owner", "requester", "early", "return", "unconfirmed", "stale"])(
  "rejects invalid owner receipt: %s",
  async (failure) => {
    const f = await fixture(true);
    f.row.status = "DISPATCHED";
    if (failure === "owner") f.accounts.ownerWallet = temporaryWallet().address;
    if (failure === "requester") f.row.requesterWallet = temporaryWallet().address;
    if (failure === "early") f.row.status = "APPROVED";
    if (failure === "return") f.row.kind = "RETURN_TO_KATHA";
    if (failure === "stale")
      vi.mocked(f.store.reportReceipt).mockResolvedValueOnce(null);
    await expect(
      f.service.reportReceipt("Bearer synthetic", f.row.id, {
        expectedUpdatedAt: f.row.updatedAt.toISOString(),
        receiptConfirmed: failure !== "unconfirmed",
      }),
    ).rejects.toBeInstanceOf(DomainError);
    if (failure !== "stale") expect(f.store.reportReceipt).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
  },
);
it.each(["REQUESTED", "APPROVED"] as const)(
  "the requester can withdraw a %s request before dispatch without custody effects",
  async (status) => {
    const f = await fixture(true);
    f.row.status = status;
    const result = await f.service.cancel("Bearer synthetic", f.row.id, {
      expectedUpdatedAt: f.row.updatedAt.toISOString(),
      cancellationConfirmed: true,
    });
    expect(result.status).toBe("CANCELLED");
    expect(f.store.cancelByRequester).toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ id: f.row.id }) }),
      f.session.walletAddress,
      f.row.updatedAt.toISOString(),
    );
    expect(f.update).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.simulate).not.toHaveBeenCalled();
  },
);
it.each([
  "owner",
  "requester",
  "dispatched",
  "received",
  "cancelled",
  "unconfirmed",
  "stale",
  "missing",
])("rejects collector cancellation: %s", async (failure) => {
  const f = await fixture(true);
  if (failure === "owner") f.accounts.ownerWallet = temporaryWallet().address;
  if (failure === "requester") f.row.requesterWallet = temporaryWallet().address;
  if (failure === "dispatched") f.row.status = "DISPATCHED";
  if (failure === "received") f.row.status = "RECEIVED";
  if (failure === "cancelled") f.row.status = "CANCELLED";
  if (failure === "stale")
    vi.mocked(f.store.cancelByRequester).mockResolvedValueOnce(null);
  if (failure === "missing") f.findRequest.mockResolvedValueOnce(null);
  await expect(
    f.service.cancel("Bearer synthetic", f.row.id, {
      expectedUpdatedAt: f.row.updatedAt.toISOString(),
      cancellationConfirmed: failure !== "unconfirmed",
    }),
  ).rejects.toMatchObject({
    code:
      failure === "owner" || failure === "requester"
        ? "FORBIDDEN"
        : failure === "unconfirmed"
          ? "INVALID_REQUEST"
          : failure === "missing"
            ? "NOT_FOUND"
            : "CONFLICT",
  });
  if (failure !== "stale") expect(f.store.cancelByRequester).not.toHaveBeenCalled();
});
it("cancellation requires a signed-in session", async () => {
  const f = await fixture(true);
  await expect(
    f.service.cancel(undefined, f.row.id, {
      expectedUpdatedAt: f.row.updatedAt.toISOString(),
      cancellationConfirmed: true,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.findRequest).not.toHaveBeenCalled();
});
it("delivery review and receipt routes validate inputs and prohibit public caching", async () => {
  const f = await fixture(true);
  f.row.status = "DISPATCHED";
  const app = createApi(
    undefined,
    undefined,
    [],
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
    undefined,
    f.service,
  );
  const path = `/fulfillment/artworks/${f.snapshot.artwork.kathaId}`;
  const headers = { Authorization: "Bearer synthetic" };
  const page = await app.request(`${path}?limit=20&offset=0`, { headers });
  expect(page.status).toBe(200);
  expect(page.headers.get("Cache-Control")).toBe("no-store");
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(`${path}?limit=101`, { headers })).status).toBe(400);
  const receipt = await app.request(`/fulfillment/${f.row.id}/receipt`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedUpdatedAt: f.row.updatedAt.toISOString(),
      receiptConfirmed: true,
    }),
  });
  expect(receipt.status).toBe(200);
  expect(receipt.headers.get("Cache-Control")).toBe("no-store");
  expect(fulfillmentResponseSchema.parse(await receipt.json()).status).toBe(
    "DISPATCHED",
  );
  f.row.status = "REQUESTED";
  const cancel = (body: unknown) =>
    app.request(`/fulfillment/${f.row.id}/cancel`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const cancelled = await cancel({
    expectedUpdatedAt: f.row.updatedAt.toISOString(),
    cancellationConfirmed: true,
  });
  expect(cancelled.status).toBe(200);
  expect(cancelled.headers.get("Cache-Control")).toBe("no-store");
  expect(fulfillmentResponseSchema.parse(await cancelled.json()).status).toBe(
    "CANCELLED",
  );
  expect(
    (
      await cancel({
        expectedUpdatedAt: f.row.updatedAt.toISOString(),
        cancellationConfirmed: true,
        status: "RECEIVED",
      })
    ).status,
  ).toBe(400);
});
