import { validateSignedPreparation } from "@katha/solana";
import { mintFixture } from "./fixtures/minting.js";
import { metadataRevisionFixture } from "./fixtures/metadata-revision.js";
import { verificationFixture } from "./fixtures/verification.js";
import { conditionFixture } from "./fixtures/condition-attestation.js";
import { expect, it } from "vitest";
import { operationReceiptResponseSchema } from "@katha/shared";
import { ReceiptValidationError } from "@katha/solana";
import { receiptFixture } from "./fixtures/receipt.js";
import { createApi } from "../src/app.js";
it("retains a cryptographically verified signed attempt when chain outcome is unknown", async () => {
  const f = await receiptFixture();
  const before = structuredClone(f.snapshot);
  const result = await f.service.reconcile(
    "Bearer synthetic",
    f.response.operationId,
    f.request,
  );
  operationReceiptResponseSchema.parse(result);
  expect(result.status).toBe("UNKNOWN");
  expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.snapshot).toEqual(before);
});
it.each(["FINALIZED", "FAILED"] as const)(
  "reconciles %s only from trusted reader evidence",
  async (status) => {
    const f = await receiptFixture();
    f.read.mockResolvedValueOnce(
      status === "FINALIZED"
        ? {
            status,
            slot: 9007199254740993n,
            chainRecordedAt: new Date("2026-10-05T00:00:00.000Z"),
          }
        : { status, failureCode: "TRANSACTION_FAILED" },
    );
    const result = await f.service.reconcile(
      "Bearer synthetic",
      f.response.operationId,
      f.request,
    );
    expect(result.status).toBe(status);
    if (status === "FINALIZED") expect(result.slot).toBe("9007199254740993");
    expect(f.save).toHaveBeenCalledTimes(2);
    const retry = await f.service.reconcile(
      "Bearer synthetic",
      f.response.operationId,
      f.request,
    );
    expect(retry.receiptId).toBe(result.receiptId);
    expect(f.read).toHaveBeenCalledTimes(1);
  },
);
it("retains unknown through RPC outage and redacts the failure", async () => {
  const f = await receiptFixture();
  f.read.mockRejectedValueOnce(new Error("PRIVATE RPC"));
  expect(
    (await f.service.reconcile("Bearer synthetic", f.response.operationId, f.request))
      .status,
  ).toBe("UNKNOWN");
});
it("rejects mismatched RPC evidence without turning it into failure or success", async () => {
  const f = await receiptFixture();
  f.read.mockRejectedValueOnce(new ReceiptValidationError());
  await expect(
    f.service.reconcile("Bearer synthetic", f.response.operationId, f.request),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.save).toHaveBeenCalledTimes(1);
});
it.each([
  "unsigned",
  "signature",
  "message",
  "hash",
  "intent",
  "program",
  "accounts",
  "commitments",
  "kind",
  "cluster",
  "wallet",
  "missing",
  "save-conflict",
])("rejects %s receipt", async (reason) => {
  const f = await receiptFixture();
  if (reason === "unsigned")
    f.request.transactionBase64 = f.snapshot.preparation.transactionBase64;
  if (reason === "signature" || reason === "message") {
    const b = Buffer.from(f.request.transactionBase64, "base64");
    const index = reason === "signature" ? 1 : b.length - 1;
    b[index] = b[index]! ^ 1;
    f.request.transactionBase64 = b.toString("base64");
  }
  if (reason === "hash") f.snapshot.preparation.messageHash = "a".repeat(64);
  if (reason === "intent") f.snapshot.operation.requestHash = "a".repeat(64);
  if (reason === "program")
    f.snapshot.operation.programAddress = f.session.walletAddress;
  if (reason === "accounts")
    f.snapshot.operation.expectedAccounts = [f.session.walletAddress];
  if (reason === "commitments") f.snapshot.operation.expectedHashes = ["a".repeat(64)];
  if (reason === "kind") f.snapshot.operation.kind = "MINT_ARTWORK";
  if (reason === "cluster") f.session.cluster = "devnet";
  if (reason === "wallet")
    f.snapshot.walletAddress = "11111111111111111111111111111111";
  if (reason === "missing") f.load.mockResolvedValueOnce(null);
  if (reason === "save-conflict") f.save.mockResolvedValueOnce({ status: "conflict" });
  await expect(
    f.service.reconcile("Bearer synthetic", f.response.operationId, f.request),
  ).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
  if (reason !== "save-conflict") expect(f.save).not.toHaveBeenCalled();
});
it("authenticates before loading a private operation", async () => {
  const f = await receiptFixture();
  await expect(
    f.service.reconcile(undefined, f.response.operationId, f.request),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.load).not.toHaveBeenCalled();
});
it("installs strict private no-store receipt route", async () => {
  const f = await receiptFixture();
  const app = createApi(
    undefined,
    undefined,
    [],
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    f.service,
  );
  const send = (body: unknown = f.request, suffix = "") =>
    app.request(`/operations/${f.response.operationId}/receipts${suffix}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer synthetic",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const response = await send();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect((await send({ ...f.request, status: "FINALIZED" })).status).toBe(400);
  expect((await send(f.request, "?cluster=devnet")).status).toBe(400);
});

it.each([
  ["verification", () => verificationFixture()],
  ["condition-initial", () => conditionFixture("initial")],
  ["condition-unminted", () => conditionFixture("unminted")],
  ["condition-minted", () => conditionFixture("minted")],
  ["mint", () => mintFixture()],
  ["metadata-initial", () => metadataRevisionFixture("INITIALIZE")],
  ["metadata-unminted", () => metadataRevisionFixture("UNMINTED")],
  ["metadata-minted", () => metadataRevisionFixture("MINTED")],
] as const)(
  "validates stored %s instruction accounts, roles and commitments",
  async (_, factory) => {
    const f = await factory();
    await f.service.prepare("Bearer synthetic", f.snapshot.artwork.kathaId, f.request);
    const [operation, , , preparation] = f.save.mock.calls[0]!;
    const signed = Buffer.from(preparation.transactionBase64, "base64");
    f.testWallet.signBytes(signed.subarray(65)).copy(signed, 1);
    expect(
      (
        await validateSignedPreparation(signed.toString("base64"), {
          ...preparation,
          ...operation,
          wallet: f.session.walletAddress,
          cluster: "localnet",
        })
      ).messageHash,
    ).toBe(preparation.messageHash);
  },
);

it.each([false, true])(
  "validates custody initialization/revision receipt, advancing=%s",
  async (advance) => {
    const {
      buildInitializeCustodyTransaction,
      buildTransitionCustodyTransaction,
      encodeUnsignedRegistryTransaction,
    } = await import("@katha/solana");
    const { canonicalDocumentBytes, sha256Hex } = await import("@katha/shared");
    const f = await mintFixture();
    const input = {
      kathaId: f.snapshot.artwork.kathaId,
      collector: null,
      transition: advance
        ? {
            action: "DISPATCH_FROM_KATHA" as const,
            from: "KATHA_HELD" as const,
            to: "IN_TRANSIT" as const,
          }
        : {
            action: "ATTEST_KATHA_CUSTODY" as const,
            from: "UNKNOWN" as const,
            to: "KATHA_HELD" as const,
          },
    };
    const context = await f.context();
    const prepared = advance
      ? await buildTransitionCustodyTransaction(context, f.accounts, {
          ...input,
          expectedRevision: 1n,
        })
      : await buildInitializeCustodyTransaction(context, f.accounts, input);
    const encoded = await encodeUnsignedRegistryTransaction(prepared);
    const instruction = prepared.instruction;
    const expectedAccounts = [
      ...new Set([
        f.session.walletAddress,
        instruction.programAddress,
        ...(instruction.accounts ?? []).map((a) => a.address),
      ]),
    ].sort();
    const canonicalRequest = new TextDecoder().decode(
      canonicalDocumentBytes({
        schemaVersion: 1,
        artworkId: f.snapshot.artwork.id,
        kathaId: f.snapshot.artwork.kathaId,
        kind: "UPDATE_CUSTODY",
        idempotencyKey: "synthetic-custody-receipt",
        expectedAccounts,
        expectedHashes: [],
        parameters: {},
        cluster: "localnet",
        walletId: f.session.walletId,
        authorityWallet: f.session.walletAddress,
        feePayer: f.session.walletAddress,
        programAddress: instruction.programAddress,
        instruction: {
          programAddress: instruction.programAddress,
          accounts: (instruction.accounts ?? []).map(({ address, role }) => ({
            address,
            role,
          })),
          dataHex: Buffer.from(instruction.data ?? []).toString("hex"),
        },
      }),
    );
    const signed = Buffer.from(encoded.transactionBase64, "base64");
    f.testWallet.signBytes(signed.subarray(65)).copy(signed, 1);
    expect(
      (
        await validateSignedPreparation(signed.toString("base64"), {
          ...encoded,
          canonicalRequest,
          requestHash: await sha256Hex(new TextEncoder().encode(canonicalRequest)),
          wallet: f.session.walletAddress,
          walletId: f.session.walletId,
          cluster: "localnet",
          kind: "UPDATE_CUSTODY",
          artworkId: f.snapshot.artwork.id,
          idempotencyKey: "synthetic-custody-receipt",
          programAddress: instruction.programAddress,
          expectedAccounts,
          expectedHashes: [],
        })
      ).messageHash,
    ).toBe(encoded.messageHash);
  },
);
