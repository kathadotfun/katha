import { canonicalDocumentBytes } from "@katha/shared";
import {
  validateSignedPreparation,
  type ReceiptPreparation,
} from "../src/operation-receipt.js";
import { sha256Hex } from "@katha/shared";
import { type Rpc, type GetTransactionApi, type GetGenesisHashApi } from "@solana/kit";
import { createOperationReceiptReaderFromRpc } from "../src/operation-receipt.js";
import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "../src/generated/marketplace/index.js";
import { expect, it, vi } from "vitest";
import {
  generateKeyPairSigner,
  compileTransaction,
  signTransaction,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
} from "@solana/kit";
import {
  createMarketplacePaymentSettlement,
  PaymentFundsError,
  PaymentValidationError,
  type PaymentBalanceReader,
} from "../src/marketplace-payment.js";
import {
  encodeUnsignedRegistryTransaction,
  OperationSimulationError,
  type OperationChain,
} from "../src/operation-preparation.js";
import {
  ReceiptValidationError,
  type ReceiptObservation,
} from "../src/operation-receipt.js";
import { buildPurchaseListingTransaction } from "../src/marketplace.js";
import { marketplaceTransactionFixture } from "./fixtures/marketplace-transactions.js";

async function fixture(version: 0 | 1 = 0) {
  const f = await marketplaceTransactionFixture();
  const buyer = await generateKeyPairSigner();
  const context = {
    ...f.context,
    cluster: version === 0 ? ("localnet" as const) : ("devnet" as const),
    authorityAddress: buyer.address,
    feePayerAddress: buyer.address,
    supportedTransactionVersions: new Set([version]),
  };
  const simulate = vi.fn<OperationChain["simulate"]>(async (prepared) => ({
    ...(await encodeUnsignedRegistryTransaction(prepared)),
    simulation: { slot: "10", unitsConsumed: "20" },
  }));
  const chain: OperationChain = { context: vi.fn(async () => context), simulate };
  const read = vi.fn(async (): Promise<ReceiptObservation> => ({
    status: "FINALIZED",
    slot: 100n,
    chainRecordedAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  const settlement = createMarketplacePaymentSettlement(chain, read, {
    cluster: context.cluster,
    paymentMint: f.mint,
  });
  const state = { accounts: f.accounts, chainTime: context.chainTime };
  const input = {
    kathaId: f.kathaId,
    expectedRevision: 1n,
    expectedPrice: "100000000",
  };
  const prepare = () =>
    settlement.prepare(
      buyer.address,
      context.supportedTransactionVersions,
      state,
      input,
    );
  const prepared = await prepare();
  const purchase = await buildPurchaseListingTransaction(context, f.accounts, {
    ...input,
    buyerAddress: buyer.address,
    paymentMintAddress: f.mint,
  });
  const signed = await signTransaction(
    [buyer.keyPair],
    compileTransaction(purchase.transactionMessage),
  );
  const wire = getBase64EncodedWireTransaction(signed);
  return {
    ...f,
    buyer,
    context,
    chain,
    simulate,
    read,
    settlement,
    state,
    input,
    prepare,
    prepared,
    signed,
    wire,
  };
}

it.each([0, 1] as const)(
  "prepares a single unsigned purchase and verifies only its buyer-signed finalized receipt with v%s",
  async (version) => {
    const f = await fixture(version);
    expect(f.simulate).toHaveBeenCalledTimes(1);
    const [purchase] = f.simulate.mock.calls[0]!;
    expect(purchase.transactionMessage.instructions).toHaveLength(1);
    expect(purchase.instruction.programAddress).toBe(KATHA_MARKETPLACE_PROGRAM_ADDRESS);
    expect(
      Object.values(
        getTransactionDecoder().decode(
          Buffer.from(f.prepared.artifact.transactionBase64, "base64"),
        ).signatures,
      ),
    ).toEqual([null]);
    expect(f.prepared.artifact.requiredSignerAddresses).toEqual([f.buyer.address]);
    expect(
      await f.settlement.verify(f.buyer.address, f.prepared, f.wire),
    ).toMatchObject({ status: "FINALIZED", slot: 100n });
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.simulate).toHaveBeenCalledTimes(1); // Verification cannot prepare/send a second payment.
  },
);

it("rejects wrong cluster/actor/fee payer, configured mint, stale quote and altered simulation artifacts", async () => {
  const f = await fixture();
  for (const override of [
    { cluster: "devnet" as const },
    { authorityAddress: f.seller },
    { feePayerAddress: f.seller },
  ]) {
    vi.mocked(f.chain.context).mockResolvedValueOnce({ ...f.context, ...override });
    await expect(f.prepare()).rejects.toBeInstanceOf(PaymentValidationError);
  }
  const wrongMint = createMarketplacePaymentSettlement(f.chain, f.read, {
    cluster: "localnet",
    paymentMint: f.seller,
  });
  await expect(
    wrongMint.prepare(f.buyer.address, new Set([0]), f.state, f.input),
  ).rejects.toThrow();
  await expect(
    f.settlement.prepare(f.buyer.address, new Set([0]), f.state, {
      ...f.input,
      expectedPrice: "1",
    }),
  ).rejects.toThrow();
  await expect(
    f.settlement.prepare(f.buyer.address, new Set([0]), f.state, {
      ...f.input,
      expectedRevision: 2n,
    }),
  ).rejects.toThrow();
  f.simulate.mockResolvedValueOnce({
    ...f.prepared.artifact,
    messageHash: "a".repeat(64),
  });
  await expect(f.prepare()).rejects.toBeInstanceOf(PaymentValidationError);
  f.simulate.mockRejectedValueOnce(new OperationSimulationError("REJECTED"));
  await expect(f.prepare()).rejects.toBeInstanceOf(OperationSimulationError);
  expect(f.read).not.toHaveBeenCalled();
});

it("rejects unsigned, forged, altered-message and cross-wallet payments before RPC", async () => {
  const f = await fixture();
  const forged = {
    ...f.signed,
    signatures: {
      ...f.signed.signatures,
      [f.buyer.address]: new Uint8Array(64).fill(1),
    },
  };
  const forgedWire = Buffer.from(getTransactionEncoder().encode(forged)).toString(
    "base64",
  );
  for (const wire of [
    f.prepared.artifact.transactionBase64,
    forgedWire,
    f.wire + "=",
    "!!!!",
  ]) {
    await expect(
      f.settlement.verify(f.buyer.address, f.prepared, wire),
    ).rejects.toBeInstanceOf(PaymentValidationError);
  }
  for (const override of [
    { cluster: "devnet" as const },
    { paymentMint: f.seller },
    { buyer: f.seller },
    { expectedPrice: "1" },
    { expectedRevision: 2n },
    { kathaId: "KATHA-PAUBHA-000002" },
    { artifact: { ...f.prepared.artifact, messageHash: "a".repeat(64) } },
  ]) {
    await expect(
      f.settlement.verify(f.buyer.address, { ...f.prepared, ...override }, f.wire),
    ).rejects.toBeInstanceOf(PaymentValidationError);
  }
  const changed = await buildPurchaseListingTransaction(
    {
      ...f.context,
      lifetime: {
        ...f.context.lifetime,
        blockhash:
          "11111111111111111111111111111112" as typeof f.context.lifetime.blockhash,
      },
    },
    f.accounts,
    { ...f.input, buyerAddress: f.buyer.address, paymentMintAddress: f.mint },
  );
  const changedWire = getBase64EncodedWireTransaction(
    await signTransaction(
      [f.buyer.keyPair],
      compileTransaction(changed.transactionMessage),
    ),
  );
  await expect(
    f.settlement.verify(f.buyer.address, f.prepared, changedWire),
  ).rejects.toBeInstanceOf(PaymentValidationError);
  await expect(
    f.settlement.verify(f.seller, f.prepared, f.wire),
  ).rejects.toBeInstanceOf(PaymentValidationError);
  expect(f.read).not.toHaveBeenCalled();
});

it("keeps missing/failed/outage receipts unsettled and rejects mismatched RPC receipts", async () => {
  const f = await fixture();
  for (const status of [
    { status: "UNKNOWN" },
    { status: "FAILED", failureCode: "TRANSACTION_FAILED" },
  ] as const) {
    f.read.mockResolvedValueOnce(status);
    expect(await f.settlement.verify(f.buyer.address, f.prepared, f.wire)).toEqual(
      status,
    );
  }
  f.read.mockRejectedValueOnce(new Error("private RPC details"));
  expect(await f.settlement.verify(f.buyer.address, f.prepared, f.wire)).toEqual({
    status: "UNKNOWN",
  });
  f.read.mockRejectedValueOnce(new ReceiptValidationError());
  await expect(
    f.settlement.verify(f.buyer.address, f.prepared, f.wire),
  ).rejects.toBeInstanceOf(PaymentValidationError);
  expect(f.simulate).toHaveBeenCalledOnce();
});

it("verifies payment against actual finalized RPC receipt decoding and rejects network/byte substitution", async () => {
  const f = await fixture(1);
  let genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  let result: unknown = {
    transaction: [f.wire, "base64"],
    version: 1,
    slot: 99n,
    blockTime: 1767225600n,
    meta: { err: null },
  };
  const getTransaction = vi.fn<
    (signature: string, config: unknown) => { send: () => Promise<unknown> }
  >(() => ({ send: async () => result }));
  const rpc = {
    getTransaction,
    getGenesisHash: () => ({ send: async () => genesis }),
  } as unknown as Rpc<GetTransactionApi & GetGenesisHashApi>;
  const settlement = createMarketplacePaymentSettlement(
    f.chain,
    createOperationReceiptReaderFromRpc(rpc, "devnet"),
    { cluster: "devnet", paymentMint: f.mint },
  );
  expect(await settlement.verify(f.buyer.address, f.prepared, f.wire)).toMatchObject({
    status: "FINALIZED",
    slot: 99n,
  });
  expect(getTransaction.mock.calls[0]).toMatchObject([
    expect.any(String),
    { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 1 },
  ]);
  result = null;
  expect(await settlement.verify(f.buyer.address, f.prepared, f.wire)).toEqual({
    status: "UNKNOWN",
  });
  result = {
    transaction: [f.wire, "base64"],
    version: 1,
    slot: 99n,
    blockTime: null,
    meta: { err: { InstructionError: [0, "InvalidArgument"] } },
  };
  expect(await settlement.verify(f.buyer.address, f.prepared, f.wire)).toEqual({
    status: "FAILED",
    failureCode: "TRANSACTION_FAILED",
  });
  result = {
    transaction: [f.prepared.artifact.transactionBase64, "base64"],
    version: 1,
    slot: 99n,
    blockTime: 1767225600n,
    meta: { err: null },
  };
  await expect(
    settlement.verify(f.buyer.address, f.prepared, f.wire),
  ).rejects.toBeInstanceOf(PaymentValidationError);
  genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
  await expect(
    settlement.verify(f.buyer.address, f.prepared, f.wire),
  ).rejects.toBeInstanceOf(PaymentValidationError);
});

it("rejects preparations containing another program or an extra independent payment instruction", async () => {
  const f = await fixture();
  const [base] = f.simulate.mock.calls[0]!;
  for (const instructions of [
    [{ ...base.instruction, programAddress: f.seller }],
    [base.instruction, base.instruction],
  ]) {
    const changed = {
      ...base,
      transactionMessage: { ...base.transactionMessage, instructions },
    };
    const transaction = compileTransaction(changed.transactionMessage);
    const artifact = {
      ...f.prepared.artifact,
      transactionBase64: getBase64EncodedWireTransaction(transaction),
      messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    };
    const wire = getBase64EncodedWireTransaction(
      await signTransaction(
        [f.buyer.keyPair],
        compileTransaction(changed.transactionMessage),
      ),
    );
    await expect(
      f.settlement.verify(f.buyer.address, { ...f.prepared, artifact }, wire),
    ).rejects.toBeInstanceOf(PaymentValidationError);
  }
  expect(f.read).not.toHaveBeenCalled();
});

it.each([0, 1] as const)(
  "accepts only the exact persisted buyer-signed purchase receipt v%s",
  async (version) => {
    const f = await fixture(version),
      instruction = f.prepared.instruction;
    const id = "11111111-1111-4111-8111-111111111111";
    const expectedAccounts = [
      ...new Set([
        f.buyer.address,
        instruction.programAddress,
        ...instruction.accounts.map((a) => a.address),
      ]),
    ].sort();
    const canonicalRequest = new TextDecoder().decode(
      canonicalDocumentBytes({
        schemaVersion: 1,
        artworkId: id,
        kathaId: f.kathaId,
        kind: "PURCHASE_ARTWORK",
        idempotencyKey: "purchase-receipt",
        expectedAccounts,
        expectedHashes: [],
        parameters: { price: f.prepared.expectedPrice },
        cluster: f.context.cluster,
        walletId: id,
        authorityWallet: f.buyer.address,
        feePayer: f.buyer.address,
        programAddress: instruction.programAddress,
        instruction: {
          programAddress: instruction.programAddress,
          accounts: instruction.accounts.map(({ address, role }) => ({
            address,
            role,
          })),
          dataHex: Buffer.from(instruction.data).toString("hex"),
        },
      }),
    );
    const expected: ReceiptPreparation = {
      ...f.prepared.artifact,
      canonicalRequest,
      requestHash: await sha256Hex(new TextEncoder().encode(canonicalRequest)),
      wallet: f.buyer.address,
      walletId: id,
      cluster: f.context.cluster,
      kind: "PURCHASE_ARTWORK",
      artworkId: id,
      idempotencyKey: "purchase-receipt",
      programAddress: instruction.programAddress,
      expectedAccounts,
      expectedHashes: [],
    };
    expect((await validateSignedPreparation(f.wire, expected)).messageHash).toBe(
      f.prepared.artifact.messageHash,
    );
    await expect(
      validateSignedPreparation(f.prepared.artifact.transactionBase64, expected),
    ).rejects.toThrow();
    const changed = new TextDecoder().decode(
      canonicalDocumentBytes({
        ...JSON.parse(canonicalRequest),
        kind: "CREATE_LISTING",
      }),
    );
    await expect(
      validateSignedPreparation(f.wire, {
        ...expected,
        kind: "CREATE_LISTING",
        canonicalRequest: changed,
        requestHash: await sha256Hex(new TextEncoder().encode(changed)),
      }),
    ).rejects.toThrow();
  },
);

it("checks the buyer's payment-token balance before simulating and names a shortfall", async () => {
  const f = await fixture();
  const balance = vi.fn<PaymentBalanceReader>(async () => 100000000n);
  const funded = createMarketplacePaymentSettlement(
    f.chain,
    f.read,
    { cluster: "localnet", paymentMint: f.mint },
    balance,
  );
  const prepare = () => funded.prepare(f.buyer.address, new Set([0]), f.state, f.input);
  f.simulate.mockClear();
  // Exactly the price is enough; the network fee is paid in SOL, not the test token.
  await expect(prepare()).resolves.toMatchObject({ buyer: f.buyer.address });
  expect(balance).toHaveBeenCalledWith(f.buyer.address, f.mint);
  for (const value of [99999999n, 0n, null]) {
    balance.mockResolvedValueOnce(value);
    await expect(prepare()).rejects.toBeInstanceOf(PaymentFundsError);
  }
  expect(f.simulate).toHaveBeenCalledTimes(1);
  // RPC failures stay unavailability, never a misleading funds message.
  balance.mockRejectedValueOnce(new Error("rpc down"));
  await expect(prepare()).rejects.not.toBeInstanceOf(PaymentFundsError);
});
