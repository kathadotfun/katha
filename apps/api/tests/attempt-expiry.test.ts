import { expect, it, vi } from "vitest";
import { operationReceiptResponseSchema } from "@katha/shared";
import type { AttemptExpiryReader } from "@katha/solana";
import { receiptFixture } from "./fixtures/receipt.js";
import { createExpiredAttemptResolver } from "../src/operation-receipts.js";

it("fails a dropped attempt only once its exact preparation has provably expired", async () => {
  const f = await receiptFixture();
  f.expired.mockResolvedValueOnce(true);
  const result = operationReceiptResponseSchema.parse(
    await f.service.reconcile("Bearer synthetic", f.response.operationId, f.request),
  );
  expect(result).toMatchObject({ status: "FAILED", failureCode: "BLOCKHASH_EXPIRED" });
  expect(f.expired).toHaveBeenCalledWith(
    result.signature,
    f.snapshot.preparation.lastValidBlockHeight,
  );
  expect(f.expireAttempt).toHaveBeenCalledTimes(1);
});

it.each([
  ["still within its lifetime", () => Promise.resolve(false)],
  ["unverifiable", () => Promise.reject(new Error("PRIVATE RPC"))],
] as const)("keeps an attempt unknown while expiry is %s", async (_, outcome) => {
  const f = await receiptFixture();
  f.expired.mockImplementationOnce(outcome);
  const result = await f.service.reconcile(
    "Bearer synthetic",
    f.response.operationId,
    f.request,
  );
  expect(result.status).toBe("UNKNOWN");
  expect(f.expireAttempt).not.toHaveBeenCalled();
});

it("does not consult expiry when the chain has a recorded outcome", async () => {
  const f = await receiptFixture();
  f.read.mockResolvedValueOnce({ status: "FAILED", failureCode: "TRANSACTION_FAILED" });
  const result = await f.service.reconcile(
    "Bearer synthetic",
    f.response.operationId,
    f.request,
  );
  expect(result.failureCode).toBe("TRANSACTION_FAILED");
  expect(f.expired).not.toHaveBeenCalled();
});

it("sweeps retained attempts without their signed bytes and tolerates RPC doubt", async () => {
  const attempts = [
    { receiptId: "a", signature: "sig-a", lastValidBlockHeight: 10n },
    { receiptId: "b", signature: "sig-b", lastValidBlockHeight: 20n },
    { receiptId: "c", signature: "sig-c", lastValidBlockHeight: 30n },
  ];
  const store = {
    listUnknownAttempts: vi.fn(async () => attempts),
    expireAttempt: vi.fn(async () => true),
  };
  const expired = vi.fn<AttemptExpiryReader>(async (signature) => {
    if (signature === "sig-b") throw new Error("PRIVATE RPC");
    return signature === "sig-a";
  });
  const resolve = createExpiredAttemptResolver(store, expired, "devnet", 7);
  expect(await resolve()).toBe(1);
  expect(store.listUnknownAttempts).toHaveBeenCalledWith("DEVNET", 7);
  expect(store.expireAttempt).toHaveBeenCalledExactlyOnceWith("a");
});
