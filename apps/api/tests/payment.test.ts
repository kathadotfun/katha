import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  OperationSimulationError,
  PaymentValidationError,
  type MarketplacePaymentSettlement,
  type PaymentPreparation,
  type PaymentArtworkState,
} from "@katha/solana";
import { createDevnetPaymentProvider } from "../src/payment.js";
import { DomainError } from "../src/errors.js";
import { temporaryWallet } from "./fixtures/wallet.js";

function fixture() {
  const wallet = temporaryWallet().address,
    mint = temporaryWallet().address;
  const session = {
    walletId: randomUUID(),
    walletAddress: wallet,
    cluster: "devnet" as const,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const authenticate = vi.fn(async (bearer: string | undefined) => {
    if (bearer !== "Bearer test") throw new DomainError("UNAUTHENTICATED");
    return session;
  });
  const prepared: PaymentPreparation = {
    cluster: "devnet",
    buyer: wallet,
    paymentMint: mint,
    kathaId: "KATHA-PAUBHA-000001",
    expectedPrice: "100000000",
    expectedRevision: 1n,
    artifact: {} as PaymentPreparation["artifact"],
  };
  const prepare = vi.fn<MarketplacePaymentSettlement["prepare"]>(async () => prepared);
  const verify = vi.fn<MarketplacePaymentSettlement["verify"]>(async () => ({
    status: "FINALIZED",
    slot: 99n,
    chainRecordedAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  const provider = createDevnetPaymentProvider(
    { authenticate },
    {
      config: {
        cluster: "devnet",
        paymentMint: mint as MarketplacePaymentSettlement["config"]["paymentMint"],
      },
      prepare,
      verify,
    },
  );
  // State belongs to a future server-side reader; the auth test never dereferences it.
  const state = { accounts: {}, chainTime: 1n } as PaymentArtworkState;
  const input = {
    kathaId: "KATHA-PAUBHA-000001",
    expectedRevision: 1n,
    expectedPrice: "100000000",
  };
  const versions = new Set([0] as const);
  return {
    session,
    prepared,
    authenticate,
    prepare,
    verify,
    provider,
    state,
    input,
    versions,
  };
}

it("authenticates the buyer, labels test economics and returns unsigned preparation and receipt projections", async () => {
  const f = fixture();
  expect(f.provider.description).toMatchObject({
    kind: "DEVNET_TEST_TOKEN",
    cluster: "devnet",
    decimals: 6,
    simulation: true,
  });
  const prepared = await f.provider.prepare(
    "Bearer test",
    f.state,
    f.input,
    f.versions,
  );
  expect(prepared.walletId).toBe(f.session.walletId);
  expect(f.prepare).toHaveBeenCalledWith(
    f.session.walletAddress,
    f.versions,
    f.state,
    f.input,
  );
  expect(await f.provider.verify("Bearer test", prepared, "signed-wire")).toEqual({
    status: "FINALIZED",
    slot: "99",
    chainRecordedAt: "2026-01-01T00:00:00.000Z",
  });
});

it("rejects absent sessions and cross-network preparation before chain access", async () => {
  const f = fixture();
  await expect(
    f.provider.prepare(undefined, f.state, f.input, f.versions),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  f.authenticate.mockResolvedValueOnce({
    ...f.session,
    cluster: "localnet" as typeof f.session.cluster,
  });
  await expect(
    f.provider.prepare("Bearer test", f.state, f.input, f.versions),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.prepare).not.toHaveBeenCalled();
});

it("requires the original authenticated wallet and wallet record when verifying", async () => {
  const f = fixture();
  for (const changed of [
    { walletId: randomUUID() },
    { buyer: temporaryWallet().address },
  ]) {
    await expect(
      f.provider.verify(
        "Bearer test",
        { ...f.prepared, walletId: f.session.walletId, ...changed },
        "signed-wire",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(
    f.provider.verify(
      undefined,
      { ...f.prepared, walletId: f.session.walletId },
      "signed-wire",
    ),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.verify).not.toHaveBeenCalled();
});

it("maps stale or rejected preparation to conflict and redacts unavailable chain errors", async () => {
  const f = fixture();
  for (const error of [
    new TypeError("private input"),
    new PaymentValidationError(),
    new OperationSimulationError("REJECTED"),
  ]) {
    f.prepare.mockRejectedValueOnce(error);
    await expect(
      f.provider.prepare("Bearer test", f.state, f.input, f.versions),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }
  f.prepare.mockRejectedValueOnce(new OperationSimulationError("UNAVAILABLE"));
  await expect(
    f.provider.prepare("Bearer test", f.state, f.input, f.versions),
  ).rejects.toThrow("Payment preparation unavailable");
});

it("preserves unknown and failed receipts and rejects tampered signed preparations", async () => {
  const f = fixture(),
    prepared = { ...f.prepared, walletId: f.session.walletId };
  for (const receipt of [
    { status: "UNKNOWN" },
    { status: "FAILED", failureCode: "TRANSACTION_FAILED" },
  ] as const) {
    f.verify.mockResolvedValueOnce(receipt);
    expect(await f.provider.verify("Bearer test", prepared, "signed-wire")).toEqual(
      receipt,
    );
  }
  f.verify.mockRejectedValueOnce(new PaymentValidationError());
  await expect(
    f.provider.verify("Bearer test", prepared, "tampered-wire"),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.prepare).not.toHaveBeenCalled();
});
