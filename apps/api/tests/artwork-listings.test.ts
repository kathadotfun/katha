import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createArtworkListings } from "../src/artwork-listings.js";
import { DomainError } from "../src/errors.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { temporaryWallet } from "./fixtures/wallet.js";
import { listingPreparationResponseSchema } from "@katha/shared";
import {
  OperationSimulationError,
  type MarketplaceListingReader,
  type OperationChain,
  type buildCreateListingTransaction,
} from "@katha/solana";
import type { MarketplaceListingStore } from "@katha/db";
import {
  ListingStatus,
  SaleKind,
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
} from "@katha/solana/marketplace";
const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  cancel: vi.fn(),
  encode: vi.fn(),
}));
vi.mock("@katha/solana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@katha/solana")>()),
  buildCreateListingTransaction: mocked.create,
  buildCancelListingTransaction: mocked.cancel,
  encodeUnsignedRegistryTransaction: mocked.encode,
}));
function fixture() {
  const wallet = temporaryWallet().address,
    id = randomUUID(),
    artistId = randomUUID(),
    kathaId = "KATHA-PAUBHA-000001";
  const session = {
    walletId: randomUUID(),
    walletAddress: wallet,
    cluster: "localnet" as const,
    sessionId: randomUUID(),
    expiresAt: "2026-10-09T00:00:00.000Z",
  };
  const artifact = {
    transactionBase64: "AQ==",
    messageHash: "a".repeat(64),
    transactionVersion: 0 as const,
    feePayer: wallet,
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 100n,
    requiredSignerAddresses: [wallet],
    simulation: { slot: "9007199254740993", unitsConsumed: "5000" },
  } as unknown as Awaited<ReturnType<OperationChain["simulate"]>>;
  const prepared = {
    instruction: {
      programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      accounts: [{ address: wallet, role: 3 }],
      data: new Uint8Array([1, 2]),
    },
    nextRevision: 2n,
  } as unknown as Awaited<ReturnType<typeof buildCreateListingTransaction>>;
  mocked.create.mockReset().mockResolvedValue(prepared);
  mocked.cancel.mockReset().mockResolvedValue(prepared);
  mocked.encode.mockReset().mockResolvedValue(artifact);
  const state = {
    owner: wallet,
    asset: temporaryWallet().address,
    revision: 1n,
    artistId,
    listing: temporaryWallet().address,
    active: true,
    ledger: {
      status: ListingStatus.Active,
      revision: 1n,
      completedSales: 0n,
      saleKind: SaleKind.Primary,
      seller: wallet,
      paymentMint: temporaryWallet().address,
      price: 100000000n,
      createdAt: 1800000000n,
      expiresAt: 1800003600n,
    },
  };
  const read = vi.fn<MarketplaceListingReader>(
    async () =>
      ({
        accounts: {},
        chainTime: 1800000000n,
        observedSlot: 9007199254740993n,
        state,
      }) as unknown as Awaited<ReturnType<MarketplaceListingReader>>,
  );
  const load = vi.fn<MarketplaceListingStore["load"]>(async () => ({
    id,
    kathaId,
    artistId,
  }));
  const save = vi.fn<MarketplaceListingStore["save"]>(async () => ({
    status: "saved",
    operationId: randomUUID(),
    preparationId: randomUUID(),
  }));
  const authenticate = vi.fn(async (bearer: string | undefined) => {
    if (bearer !== "Bearer synthetic") throw new DomainError("UNAUTHENTICATED");
    return session;
  });
  const context = vi.fn<OperationChain["context"]>(
    async () =>
      ({
        cluster: "localnet",
        authorityAddress: wallet,
        feePayerAddress: wallet,
        supportedTransactionVersions: new Set([0]),
        lifetime: { blockhash: artifact.blockhash, lastValidBlockHeight: 100n },
        currentBlockHeight: 1n,
      }) as unknown as Awaited<ReturnType<OperationChain["context"]>>,
  );
  const simulate = vi.fn<OperationChain["simulate"]>(async () => artifact);
  const service = createArtworkListings(
    { load, save },
    { authenticate },
    read,
    { context, simulate },
    "localnet",
  );
  const request = {
    idempotencyKey: "listing-request",
    expectedRevision: "1",
    price: "100000000",
    expiresAt: "1800003600",
    supportedTransactionVersions: [0],
  };
  const cancel = {
    idempotencyKey: "listing-cancel",
    expectedRevision: "1",
    supportedTransactionVersions: [0],
  };
  return {
    service,
    request,
    cancel,
    read,
    load,
    save,
    simulate,
    context,
    state,
    session,
    kathaId,
    artifact,
  };
}
it("prepares unsigned owner operations, binds exact canonical intent and preserves private fields", async () => {
  const f = fixture();
  const response = await f.service.prepareListing(
    "Bearer synthetic",
    f.kathaId,
    f.request,
  );
  listingPreparationResponseSchema.parse(response);
  expect(response.kind).toBe("CREATE_LISTING");
  expect(response.nextRevision).toBe("2");
  const [operation, actor, identity, persisted] = f.save.mock.calls[0]!;
  expect(operation).toMatchObject({
    kind: "CREATE_LISTING",
    programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    walletId: f.session.walletId,
  });
  expect(actor).toBe(f.session.walletAddress);
  expect(identity).toBe(f.kathaId);
  expect(JSON.parse(persisted.canonicalRequest)).toMatchObject({
    parameters: { expectedRevision: "1", price: "100000000", expiresAt: "1800003600" },
    authorityWallet: actor,
  });
  expect(persisted.simulationSlot).toBe(9007199254740993n);
  expect(response).not.toHaveProperty("canonicalRequest");
  expect(
    (await f.service.prepareCancellation("Bearer synthetic", f.kathaId, f.cancel)).kind,
  ).toBe("CANCEL_LISTING");
});
it("reads finalized listing revisions and exposes expiry without changing recorded status", async () => {
  const f = fixture();
  expect(await f.service.get(f.kathaId)).toMatchObject({
    commitment: "finalized",
    observedSlot: "9007199254740993",
    owner: f.session.walletAddress,
    listing: { active: true, status: "ACTIVE", price: "100000000" },
  });
  f.state.active = false;
  expect((await f.service.get(f.kathaId)).listing).toMatchObject({
    active: false,
    status: "ACTIVE",
  });
});
it.each([
  "auth",
  "cluster",
  "owner",
  "artist",
  "missing",
  "revision",
  "simulation",
  "artifact",
  "store-conflict",
  "store-missing",
])("denies unsafe preparation without unsafe persistence: %s", async (reason) => {
  const f = fixture();
  let bearer = "Bearer synthetic",
    code = "CONFLICT";
  if (reason === "auth") {
    bearer = "Bearer outsider";
    code = "UNAUTHENTICATED";
  }
  if (reason === "cluster") {
    Object.assign(f.session, { cluster: "devnet" });
    code = "FORBIDDEN";
  }
  if (reason === "owner") {
    f.state.owner = temporaryWallet().address;
    code = "FORBIDDEN";
  }
  if (reason === "artist") f.state.artistId = randomUUID();
  if (reason === "missing") {
    f.load.mockResolvedValueOnce(null);
    code = "NOT_FOUND";
  }
  if (reason === "revision")
    mocked.create.mockRejectedValueOnce(new TypeError("stale"));
  if (reason === "simulation")
    f.simulate.mockRejectedValueOnce(new OperationSimulationError("REJECTED"));
  if (reason === "artifact")
    f.simulate.mockResolvedValueOnce({ ...f.artifact, messageHash: "b".repeat(64) });
  if (reason === "store-conflict") f.save.mockResolvedValueOnce({ status: "conflict" });
  if (reason === "store-missing") {
    f.save.mockResolvedValueOnce({ status: "not_found" });
    code = "NOT_FOUND";
  }
  await expect(
    f.service.prepareListing(bearer, f.kathaId, f.request),
  ).rejects.toMatchObject({ code });
  if (!reason.startsWith("store-")) expect(f.save).not.toHaveBeenCalled();
});
it("rejects malformed cancellation and redacts chain outages through HTTP", async () => {
  const f = fixture();
  await expect(
    f.service.prepareCancellation("Bearer synthetic", f.kathaId, f.request),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const logs: string[] = [];
  const args: Parameters<typeof createApi> = [createLogger((line) => logs.push(line))];
  args[22] = f.service;
  const app = createApi(...args),
    path = `/artworks/${f.kathaId}`;
  const get = await app.request(path + "/listing");
  expect(get.status).toBe(200);
  expect(get.headers.get("Cache-Control")).toBe("no-store");
  const post = (suffix: string, body: unknown, bearer = "Bearer synthetic") =>
    app.request(path + "/operations/" + suffix, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: bearer },
      body: JSON.stringify(body),
    });
  expect((await post("listing", f.request)).status).toBe(201);
  expect((await post("cancellation", f.cancel)).status).toBe(201);
  expect((await post("listing", f.request, "Bearer outsider")).status).toBe(401);
  expect((await post("listing", { ...f.request, custody: "client" })).status).toBe(400);
  expect((await app.request(path + "/listing?cluster=devnet")).status).toBe(400);
  f.read.mockRejectedValueOnce(new Error("PRIVATE RPC SECRET"));
  const unavailable = await app.request(path + "/listing");
  expect(unavailable.status).toBe(500);
  expect(await unavailable.text()).not.toContain("PRIVATE");
  expect(logs.join("\n")).not.toContain("PRIVATE RPC SECRET");
});
