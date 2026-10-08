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
import { getCreateListingInstructionAsync } from "@katha/solana/marketplace";
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
  const ix = await getCreateListingInstructionAsync({
    artwork,
    conditionReport: report,
    collection: address(collection),
    seller: signer,
    price: patch.price ?? 12500001n,
    expiresAt: patch.expiresAt ?? 1900000000n,
    expectedRevision: patch.expectedRevision ?? 0n,
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
