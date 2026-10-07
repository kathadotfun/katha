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
  getMintArtworkInstructionAsync,
  findArtworkPda,
  findAssetPda,
  findCollectionAuthorityPda,
  findReportPda,
  findReviseMintedMetadataRevisionPda,
} from "@katha/solana/registry";
import { sha256Hex, type ArtworkMintReview } from "@katha/shared";
import { registrationFixture } from "./registration.ts";
export async function mintingFixture(
  walletAddress = "11111111111111111111111111111112",
  overrides: Record<string, string> = {},
) {
  const f = await registrationFixture(undefined, walletAddress),
    { registration, ...base } = f.page;
  const [artwork] = await findArtworkPda({ kathaId: base.kathaId }),
    [asset] = await findAssetPda({ artwork }),
    [collectionAuthority] = await findCollectionAuthorityPda();
  const reportId = "aaaaaaaa-1111-4111-8111-111111111111",
    [report] = await findReportPda({
      reportId: Uint8Array.from(Buffer.from(reportId.replaceAll("-", ""), "hex")),
    }),
    [metadataRevision] = await findReviseMintedMetadataRevisionPda({
      artwork,
      nextVersion: 1,
    });
  const page: ArtworkMintReview = {
    ...base,
    initialReport: { id: reportId, documentHash: "b".repeat(64) },
    chain: {
      asset,
      collection: "11111111111111111111111111111114",
      collectionAuthority,
      registrationAuthority: walletAddress,
      owner: null,
      minted: false,
      metadataVersion: 1,
      conditionVersion: 1,
      custodyRevision: "1",
      custodyState: "KATHA_HELD",
    },
    reservation: null,
    mint: registration,
    canMint: true,
    canPublish: false,
    blockedReasons: [],
  };
  const instruction = await getMintArtworkInstructionAsync({
    artwork,
    metadataRevision,
    initialCondition: report,
    collection: address(page.chain!.collection),
    registrationAuthority: createNoopSigner(address(walletAddress)),
    ...Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, address(value)]),
    ),
  });
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(walletAddress), msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash(f.operation.blockhash), lastValidBlockHeight: 1000n },
          msg,
        ),
      (msg) => appendTransactionMessageInstruction(instruction, msg),
    ),
  );
  const operation = {
    ...f.operation,
    kind: "MINT_ARTWORK" as const,
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
  };
  const review = {
    asset,
    collection: page.chain!.collection,
    collectionAuthority,
    initialConditionReportId: reportId,
    metadataVersion: 1,
  };
  return { page, operation, review };
}
