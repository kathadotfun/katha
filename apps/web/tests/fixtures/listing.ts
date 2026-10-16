import {
  address,
  createNoopSigner,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  blockhash,
  pipe,
} from "@solana/kit";
import {
  getCreateListingWithFeesInstructionAsync,
  getCancelListingInstructionAsync,
} from "@katha/solana/marketplace";
import {
  findArtworkPda,
  findReportPda,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
} from "@katha/solana/registry";
import { sha256Hex, type ListingPreparationResponse } from "@katha/shared";
export async function listingFixture(
  patch: {
    wallet?: string;
    kathaId?: string;
    price?: bigint;
    expiresAt?: bigint;
    expectedRevision?: bigint;
    seller?: string;
    coreProgram?: string;
  } = {},
) {
  const wallet = patch.wallet ?? "11111111111111111111111111111112",
    kathaId = patch.kathaId ?? "KATHA-PAUBHA-000050",
    collection = "11111111111111111111111111111113";
  const [artwork] = await findArtworkPda({ kathaId });
  const [report] = await findReportPda({
    reportId: new Uint8Array(16).fill(1),
  });
  const signer = createNoopSigner(address(patch.seller ?? wallet));
  const ix = await getCreateListingWithFeesInstructionAsync({
    artwork,
    conditionReport: report,
    collection: address(collection),
    seller: signer,
    price: patch.price ?? 12500001n,
    expiresAt: patch.expiresAt ?? 1900000000n,
    expectedRevision: patch.expectedRevision ?? 0n,
    expectedFeeRevision: 1n,
    expectedCommissionBps: 1000,
    expectedSecondaryRoyaltyBps: 0,
    registryProgram: KATHA_REGISTRY_PROGRAM_ADDRESS,
    ...(patch.coreProgram ? { coreProgram: address(patch.coreProgram) } : {}),
  });
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(wallet), msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: 1000n,
          },
          msg,
        ),
      (msg) => appendTransactionMessageInstruction(ix, msg),
    ),
  );
  const operation: ListingPreparationResponse & { kind: "CREATE_LISTING" } = {
    operationId: "dddddddd-1111-4111-8111-111111111111",
    preparationId: "eeeeeeee-1111-4111-8111-111111111111",
    kathaId,
    kind: "CREATE_LISTING",
    cluster: "localnet",
    status: "PREPARED",
    requestHash: "a".repeat(64),
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
    transactionVersion: 0,
    feePayer: wallet,
    requiredSignerAddresses: [wallet],
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: "1000",
    simulation: { slot: "10", unitsConsumed: "200" },
    price: "12500001",
    expiresAt: "1900000000",
    currentRevision: "0",
    nextRevision: "1",
    fees: {
      scheduleRevision: "1",
      platformCommissionBps: 1000,
      secondaryRoyaltyBps: 0,
    },
  };
  return {
    operation,
    expected: {
      kind: "CREATE_LISTING" as const,
      kathaId,
      wallet,
      cluster: "localnet" as const,
      listing: {
        price: operation.price,
        expiresAt: operation.expiresAt,
        expectedRevision: operation.currentRevision,
        asset: String(ix.accounts[9].address),
        collection,
      },
    },
  };
}

export async function cancellationFixture(
  patch: {
    wallet?: string;
    kathaId?: string;
    actor?: string;
    revision?: bigint;
    coreProgram?: string;
  } = {},
) {
  const base = await listingFixture(patch);
  const [artwork] = await findArtworkPda({ kathaId: base.operation.kathaId });
  const ix = await getCancelListingInstructionAsync({
    artwork,
    actor: createNoopSigner(address(patch.actor ?? base.operation.feePayer)),
    collection: address(base.expected.listing.collection),
    registryProgram: KATHA_REGISTRY_PROGRAM_ADDRESS,
    expectedRevision: patch.revision ?? 1n,
    ...(patch.coreProgram ? { coreProgram: address(patch.coreProgram) } : {}),
  });
  const tx = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(base.operation.feePayer), msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash(base.operation.blockhash),
            lastValidBlockHeight: 1000n,
          },
          msg,
        ),
      (msg) => appendTransactionMessageInstruction(ix, msg),
    ),
  );
  const operation: ListingPreparationResponse & { kind: "CANCEL_LISTING" } = {
    ...base.operation,
    kind: "CANCEL_LISTING",
    currentRevision: "1",
    nextRevision: "2",
    transactionBase64: String(getBase64EncodedWireTransaction(tx)),
    messageHash: await sha256Hex(Uint8Array.from(tx.messageBytes)),
  };
  return {
    operation,
    listingAddress: String(ix.accounts[5].address),
    expected: {
      ...base.expected,
      kind: "CANCEL_LISTING" as const,
      listing: { ...base.expected.listing, expectedRevision: "1" },
    },
  };
}
