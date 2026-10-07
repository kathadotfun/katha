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
  getInitializeMetadataInstructionAsync,
  getReviseUnmintedMetadataInstructionAsync,
  getReviseMintedMetadataInstructionAsync,
  findArtworkPda,
  findAssetPda,
  findCollectionAuthorityPda,
  findReviseMintedMetadataRevisionPda,
} from "@katha/solana/registry";
import {
  canonicalDocumentBytes,
  metadataDocumentSchema,
  sha256Hex,
  type MetadataRevisionReview,
} from "@katha/shared";
import { registrationFixture } from "./registration.ts";
export async function metadataFixture(
  mode: "INITIALIZE" | "UNMINTED" | "MINTED" = "MINTED",
  overrides: Record<string, string> = {},
  changes: {
    uri?: string;
    documentHash?: Uint8Array;
    expectedVersion?: number;
    nextVersion?: number;
  } = {},
) {
  const f = await registrationFixture(),
    { registration, ...base } = f.page;
  const document = metadataDocumentSchema.parse(
    JSON.parse(base.metadata!.canonicalDocument),
  );
  const bytes = canonicalDocumentBytes({
      ...document,
      publicContent: { ...document.publicContent, story: "Revised public story" },
    }),
    hash = await sha256Hex(bytes);
  const [artwork] = await findArtworkPda({ kathaId: base.kathaId }),
    [asset] = await findAssetPda({ artwork }),
    [collectionAuthority] = await findCollectionAuthorityPda();
  const page: MetadataRevisionReview = {
    ...base,
    current: mode === "INITIALIZE" ? null : { ...base.metadata!, status: "FINALIZED" },
    metadata: {
      ...base.metadata!,
      id: "dddddddd-1111-4111-8111-111111111111",
      version: 2,
      documentHash: hash,
      canonicalDocument: new TextDecoder().decode(bytes),
      uri: `http://localhost:3001/storage/public/${hash}.json`,
    },
    chain: {
      mode,
      version: mode === "INITIALIZE" ? 0 : 1,
      documentHash: mode === "INITIALIZE" ? null : base.metadata!.documentHash,
      uri: mode === "INITIALIZE" ? null : base.metadata!.uri,
      registrationAuthority: f.operation.feePayer,
      collection: "11111111111111111111111111111114",
      collectionAuthority,
      asset: mode === "MINTED" ? asset : null,
    },
    revision: registration,
    canSave: true,
    canSubmit: true,
  };
  const [currentRevision] = await findReviseMintedMetadataRevisionPda({
    artwork,
    nextVersion: 1,
  });
  const args = {
    artwork,
    currentRevision,
    documentHash: Buffer.from(hash, "hex"),
    uri: page.metadata!.uri,
    registrationAuthority: createNoopSigner(address(f.operation.feePayer)),
    ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k, address(v)])),
    ...changes,
  };
  const instruction =
    mode === "INITIALIZE"
      ? await getInitializeMetadataInstructionAsync(args)
      : mode === "MINTED"
        ? await getReviseMintedMetadataInstructionAsync({
            ...args,
            collection: address(page.chain.collection),
            ...Object.fromEntries(
              Object.entries(overrides).map(([k, v]) => [k, address(v)]),
            ),
            expectedVersion: 1,
            nextVersion: 2,
            ...changes,
          })
        : await getReviseUnmintedMetadataInstructionAsync({
            ...args,
            expectedVersion: 1,
            nextVersion: 2,
            ...changes,
          });
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(address(f.operation.feePayer), msg),
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
    kind: "REVISE_METADATA" as const,
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
  };
  return { page, operation, review: { metadata: page.metadata, chain: page.chain } };
}
