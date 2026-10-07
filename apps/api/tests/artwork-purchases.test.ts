import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createArtworkPurchases } from "../src/artwork-purchases.js";
import { DomainError } from "../src/errors.js";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { temporaryWallet } from "./fixtures/wallet.js";
import { purchasePreparationResponseSchema, sha256Hex } from "@katha/shared";
import type { MarketplacePurchaseReader, PaymentPreparation } from "@katha/solana";
import {
  getPurchaseListingInstructionDataEncoder,
  getCancelListingDiscriminatorBytes,
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
} from "@katha/solana/marketplace";
import type { MarketplaceListingStore } from "@katha/db";
import type {
  AuthenticatedPaymentPreparation,
  PaymentProvider,
} from "../src/payment.js";
const mocked = vi.hoisted(() => ({ terms: vi.fn() }));
vi.mock("@katha/solana", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@katha/solana")>()),
  readMarketplacePurchaseTerms: mocked.terms,
}));
function fixture() {
  const wallet = temporaryWallet().address,
    seller = temporaryWallet().address,
    mint = temporaryWallet().address,
    artist = temporaryWallet().address,
    treasury = temporaryWallet().address,
    asset = temporaryWallet().address,
    listing = temporaryWallet().address;
  const id = randomUUID(),
    artistId = randomUUID(),
    kathaId = "KATHA-PAUBHA-000001";
  const session = {
    walletId: randomUUID(),
    walletAddress: wallet,
    cluster: "localnet" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const terms = {
    asset,
    listing,
    revision: "1",
    price: "100000000",
    expiresAt: "1800003600",
    saleKind: "PRIMARY",
    seller,
    artistPayout: artist,
    treasury,
    fees: { platformCommissionBps: 250, secondaryRoyaltyBps: 500 },
    paymentMint: mint,
    condition: { report: temporaryWallet().address, hash: "a".repeat(64), version: 1 },
    custodyRevision: "1",
    distribution: {
      sellerProceeds: "0",
      artistProceeds: "97500000",
      treasuryFee: "2500000",
      recipients: [
        { wallet: artist, amount: "97500000" },
        { wallet: treasury, amount: "2500000" },
      ],
    },
  };
  mocked.terms.mockReset().mockImplementation(async () => terms);
  const accounts = Array.from({ length: 22 }, () => ({
    address: temporaryWallet().address,
    role: 0,
  }));
  for (const [i, address] of [
    [9, asset],
    [10, seller],
    [11, listing],
    [14, wallet],
    [15, mint],
  ] as const)
    accounts[i] = { address, role: i === 14 ? 3 : 0 };
  const instruction = {
    programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    accounts,
    data: Uint8Array.from(
      getPurchaseListingInstructionDataEncoder().encode({
        expectedRevision: 1n,
        expectedPrice: 100000000n,
      }),
    ),
  } as unknown as PaymentPreparation["instruction"];
  const prepared = {
    walletId: session.walletId,
    buyer: wallet,
    cluster: "localnet",
    paymentMint: mint,
    kathaId,
    expectedRevision: 1n,
    expectedPrice: "100000000",
    instruction,
    nextRevision: 2n,
    artifact: {
      transactionBase64: "AQ==",
      messageHash: "b".repeat(64),
      transactionVersion: 0,
      feePayer: wallet,
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100n,
      requiredSignerAddresses: [wallet],
      simulation: { slot: "9007199254740993", unitsConsumed: "5000" },
    },
  } as unknown as AuthenticatedPaymentPreparation;
  const prepare = vi.fn<PaymentProvider["prepare"]>(async () => prepared);
  const provider: PaymentProvider = {
    description: {
      kind: "DEVNET_TEST_TOKEN",
      cluster: "localnet",
      paymentMint: mint,
      decimals: 6,
      simulation: true,
    },
    prepare,
    verify: vi.fn<PaymentProvider["verify"]>(async () => ({ status: "UNKNOWN" })),
  };
  const payment = vi.fn(() => provider);
  const authenticate = vi.fn(async (bearer: string | undefined) => {
    if (bearer !== "Bearer synthetic") throw new DomainError("UNAUTHENTICATED");
    return session;
  });
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
  const state = { artistId };
  const snapshot = {
    accounts: {},
    chainTime: 1800000000n,
    observedSlot: 9007199254740993n,
    state,
  } as unknown as Awaited<ReturnType<MarketplacePurchaseReader>>;
  const read = vi.fn<MarketplacePurchaseReader>(async () => snapshot);
  const service = createArtworkPurchases(
    { load, save },
    { authenticate },
    read,
    payment,
    "localnet",
  );
  const request = { supportedTransactionVersions: [0] };
  const quote = () => service.quote("Bearer synthetic", kathaId, request);
  const purchase = async (hash?: string) =>
    service.prepare("Bearer synthetic", kathaId, {
      ...request,
      quoteHash: hash ?? (await quote()).quoteHash,
      idempotencyKey: "purchase-001",
    });
  return {
    service,
    request,
    quote,
    purchase,
    read,
    state,
    snapshot,
    prepare,
    prepared,
    provider,
    terms,
    payment,
    load,
    save,
    session,
    kathaId,
  };
}
it("quotes exact buyer-bound simulated economics without persistence and prepares one canonical purchase", async () => {
  const f = fixture();
  const quote = await f.quote();
  expect(quote).toMatchObject({
    buyer: f.session.walletAddress,
    revision: "1",
    price: "100000000",
    observedSlot: "9007199254740993",
    payment: { simulation: true, decimals: 6 },
    distribution: { artistProceeds: "97500000" },
  });
  expect(f.save).not.toHaveBeenCalled();
  const response = await f.purchase(quote.quoteHash);
  purchasePreparationResponseSchema.parse(response);
  expect(response.kind).toBe("PURCHASE_ARTWORK");
  expect(f.provider.verify).not.toHaveBeenCalled();
  const [operation, buyer, , persisted] = f.save.mock.calls[0]!;
  expect(operation).toMatchObject({
    kind: "PURCHASE_ARTWORK",
    walletId: f.session.walletId,
    expectedHashes: [quote.quoteHash, quote.condition.hash],
  });
  expect(buyer).toBe(f.session.walletAddress);
  expect(JSON.parse(persisted.canonicalRequest)).toMatchObject({
    parameters: { quote: { buyer, price: quote.price }, quoteHash: quote.quoteHash },
  });
  expect(await sha256Hex(new TextEncoder().encode(persisted.canonicalRequest))).toBe(
    operation.requestHash,
  );
  expect(response).not.toHaveProperty("canonicalRequest");
});
it("keeps quote hashes stable across slots and clock changes but rejects changed semantic terms before simulation", async () => {
  const f = fixture();
  const quote = await f.quote();
  f.snapshot.observedSlot += 1n;
  f.snapshot.chainTime += 1n;
  expect((await f.quote()).quoteHash).toBe(quote.quoteHash);
  const original = structuredClone(f.terms);
  for (const change of [
    () => {
      f.terms.price = "100000001";
    },
    () => {
      f.terms.fees.platformCommissionBps = 251;
    },
    () => {
      f.terms.condition.hash = "c".repeat(64);
    },
    () => {
      f.terms.custodyRevision = "2";
    },
    () => {
      f.terms.revision = "2";
    },
    () => {
      f.terms.paymentMint = temporaryWallet().address;
    },
    () => {
      f.terms.artistPayout = temporaryWallet().address;
    },
    () => {
      f.session.walletAddress = temporaryWallet().address;
    },
  ]) {
    Object.assign(f.terms, structuredClone(original));
    change();
    const previous = f.prepare.mock.calls.length;
    await expect(f.purchase(quote.quoteHash)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.prepare.mock.calls.length).toBe(previous);
  }
  expect(f.save).not.toHaveBeenCalled();
});
it.each([
  "auth",
  "cluster",
  "seller",
  "artist",
  "treasury",
  "identity",
  "missing",
  "eligibility",
  "simulation",
  "provider-mint",
  "prepared-buyer",
  "instruction-price",
  "instruction-kind",
  "signer",
  "fee-payer",
  "store",
])("rejects unsafe purchase boundary %s", async (reason) => {
  const f = fixture();
  let code = "CONFLICT";
  if (reason === "auth") {
    await expect(
      f.service.quote(undefined, f.kathaId, f.request),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.read).not.toHaveBeenCalled();
    return;
  }
  if (reason === "cluster") {
    Object.assign(f.session, { cluster: "devnet" });
    code = "FORBIDDEN";
  }
  if (reason === "seller") {
    f.session.walletAddress = f.terms.seller;
    code = "FORBIDDEN";
  }
  if (reason === "artist") {
    f.session.walletAddress = f.terms.artistPayout;
    code = "FORBIDDEN";
  }
  if (reason === "treasury") {
    f.session.walletAddress = f.terms.treasury;
    code = "FORBIDDEN";
  }
  if (reason === "identity") f.state.artistId = randomUUID();
  if (reason === "missing") {
    f.load.mockResolvedValueOnce(null);
    code = "NOT_FOUND";
  }
  if (reason === "eligibility")
    mocked.terms.mockRejectedValueOnce(new TypeError("expired"));
  if (reason === "simulation")
    f.prepare.mockRejectedValueOnce(new DomainError("CONFLICT"));
  if (reason === "provider-mint")
    f.provider.description.paymentMint = temporaryWallet().address;
  if (reason === "prepared-buyer") f.prepared.buyer = temporaryWallet().address;
  if (reason === "instruction-price")
    f.prepared.instruction = {
      ...f.prepared.instruction,
      data: Uint8Array.from(
        getPurchaseListingInstructionDataEncoder().encode({
          expectedRevision: 1n,
          expectedPrice: 1n,
        }),
      ),
    };
  if (reason === "instruction-kind") {
    const data = Uint8Array.from(f.prepared.instruction.data);
    data.set(getCancelListingDiscriminatorBytes());
    f.prepared.instruction = { ...f.prepared.instruction, data };
  }
  if (reason === "signer")
    f.prepared.artifact = { ...f.prepared.artifact, requiredSignerAddresses: [] };
  if (reason === "fee-payer")
    f.prepared.artifact = {
      ...f.prepared.artifact,
      feePayer: f.prepared.instruction.accounts[10]!.address,
    };
  if (reason === "store") f.save.mockResolvedValueOnce({ status: "conflict" });
  await expect(f.purchase()).rejects.toMatchObject({ code });
  if (reason !== "store") expect(f.save).not.toHaveBeenCalled();
});
it("adds strict no-store authenticated quote/preparation HTTP routes and redacts outages", async () => {
  const f = fixture(),
    logs: string[] = [];
  const args: Parameters<typeof createApi> = [createLogger((line) => logs.push(line))];
  args[23] = f.service;
  const app = createApi(...args);
  const post = (path: string, body: unknown, auth = "Bearer synthetic") =>
    app.request(`/artworks/${f.kathaId}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body),
    });
  const quote = await post("/purchase-quote", f.request);
  expect(quote.status).toBe(200);
  expect(quote.headers.get("Cache-Control")).toBe("no-store");
  const quoteHash = ((await quote.json()) as { quoteHash: string }).quoteHash;
  const prepared = await post("/operations/purchase", {
    ...f.request,
    quoteHash,
    idempotencyKey: "http-purchase",
  });
  expect(prepared.status).toBe(201);
  purchasePreparationResponseSchema.parse(await prepared.json());
  expect((await post("/purchase-quote", f.request, "Bearer outsider")).status).toBe(
    401,
  );
  expect(
    (await post("/purchase-quote", { ...f.request, price: "client" })).status,
  ).toBe(400);
  expect(
    (
      await post("/operations/purchase", {
        ...f.request,
        quoteHash: "x",
        idempotencyKey: "bad",
      })
    ).status,
  ).toBe(400);
  f.read.mockRejectedValueOnce(new Error("PRIVATE RPC SECRET"));
  const unavailable = await post("/purchase-quote", f.request);
  expect(unavailable.status).toBe(500);
  expect(await unavailable.text()).not.toContain("PRIVATE");
  expect(logs.join("\n")).not.toContain("PRIVATE RPC SECRET");
});
