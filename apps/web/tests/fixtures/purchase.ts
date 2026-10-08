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
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { getPurchaseListingInstructionAsync } from "@katha/solana/marketplace";
import { findArtworkPda } from "@katha/solana/registry";
import {
  canonicalDocumentBytes,
  sha256Hex,
  purchaseQuoteTermsSchema,
  type PurchasePreparationResponse,
} from "@katha/shared";
import { purchaseQuoteFixture } from "./purchase-quote.ts";
export async function purchaseFixture(
  wallet = "11111111111111111111111111111112",
  patch: {
    price?: bigint;
    revision?: bigint;
    mint?: string;
    tokenAccount?: string;
    coreProgram?: string;
  } = {},
) {
  const { quote, artwork } = await purchaseQuoteFixture();
  quote.buyer = wallet;
  quote.quoteHash = await sha256Hex(
    canonicalDocumentBytes(purchaseQuoteTermsSchema.strip().parse(quote)),
  );
  const encoder = getAddressEncoder(),
    token = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const mint = address(patch.mint ?? quote.payment.paymentMint);
  const ata = async (owner: string) =>
    (
      await getProgramDerivedAddress({
        programAddress: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        seeds: [
          encoder.encode(address(owner)),
          encoder.encode(token),
          encoder.encode(mint),
        ],
      })
    )[0];
  const [buyerTokens, sellerTokens, artistTokens, treasuryTokens] = await Promise.all(
    [wallet, quote.seller, quote.artistPayout, quote.treasury].map(ata),
  );
  const [record] = await findArtworkPda({ kathaId: quote.kathaId });
  const collection = artwork.chain.collectionAddress!;
  const ix = await getPurchaseListingInstructionAsync({
    artwork: record,
    conditionReport: address(quote.condition.report),
    collection: address(collection),
    buyer: createNoopSigner(address(wallet)),
    seller: address(quote.seller),
    paymentMint: mint,
    buyerTokens: patch.tokenAccount ? address(patch.tokenAccount) : buyerTokens!,
    sellerTokens: sellerTokens!,
    artistTokens: artistTokens!,
    treasuryTokens: treasuryTokens!,
    expectedRevision: patch.revision ?? BigInt(quote.revision),
    expectedPrice: patch.price ?? BigInt(quote.price),
    ...(patch.coreProgram ? { coreProgram: address(patch.coreProgram) } : {}),
  });
  const tx = compileTransaction(
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
  const operation: PurchasePreparationResponse = {
    operationId: "dddddddd-1111-4111-8111-111111111111",
    preparationId: "eeeeeeee-1111-4111-8111-111111111111",
    kathaId: quote.kathaId,
    kind: "PURCHASE_ARTWORK",
    cluster: "localnet",
    status: "PREPARED",
    requestHash: "b".repeat(64),
    messageHash: await sha256Hex(Uint8Array.from(tx.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(tx)),
    transactionVersion: 0,
    feePayer: wallet,
    requiredSignerAddresses: [wallet],
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: "1000",
    simulation: { slot: "20", unitsConsumed: "200" },
    quote,
    nextRevision: "3",
  };
  return {
    operation,
    quote,
    artwork,
    expected: {
      kind: "PURCHASE_ARTWORK" as const,
      kathaId: quote.kathaId,
      wallet,
      cluster: "localnet" as const,
      purchase: { quote, collection },
    },
  };
}
