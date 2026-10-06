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
  getRegisterArtworkInstructionAsync,
  ArtworkCategory,
} from "@katha/solana/registry";
import {
  canonicalDocumentBytes,
  sha256Hex,
  type ArtworkRegistrationReview,
  type UnsignedOperationResponse,
} from "@katha/shared";
export async function registrationFixture(
  kathaId = "KATHA-PAUBHA-000050",
  walletAddress = "11111111111111111111111111111112",
) {
  const identity = {
    artistId: "aaaaaaaa-1111-4111-8111-111111111111",
    creatorWallet: null,
    category: "PAUBHA" as const,
    creationYear: 2026,
    authorshipEvidenceHash: "e".repeat(64),
  };
  const document = {
    schemaVersion: 1,
    kathaId,
    name: "Synthetic Nepali artwork",
    category: "PAUBHA",
    artist: {
      artistId: identity.artistId,
      displayName: "Synthetic Nepali artist",
      creatorWallet: null,
    },
    creationYear: 2026,
    origin: { countryCode: "NP", region: "Bagmati", locality: "Patan" },
    dimensions: { heightMm: 100, widthMm: 100, depthMm: null },
    materials: ["Canvas"],
    technique: "Synthetic traditional painting",
    publicContent: {
      story: "Approved synthetic cultural story",
      meaning: "Synthetic meaning",
      culturalContext: "Synthetic context",
      creationProcess: "Synthetic process",
    },
    image: "http://localhost:3001/storage/public/" + "a".repeat(64) + ".png",
    media: [
      {
        contentHash: "a".repeat(64),
        mimeType: "image/png",
        role: "HERO",
        uri: "http://localhost:3001/storage/public/" + "a".repeat(64) + ".png",
      },
    ],
  };
  const bytes = canonicalDocumentBytes(document);
  const page: ArtworkRegistrationReview = {
    kathaId,
    cluster: "localnet",
    updatedAt: "2026-10-06T00:00:00.000Z",
    title: document.name,
    identity,
    artistVerified: true,
    published: false,
    metadata: {
      id: "cccccccc-1111-4111-8111-111111111111",
      version: 1,
      status: "PREPARED",
      documentHash: await sha256Hex(bytes),
      uri: "http://localhost:3001/storage/public/" + (await sha256Hex(bytes)) + ".json",
      canonicalDocument: new TextDecoder().decode(bytes),
    },
    registration: { finalized: false, unresolved: false, receipt: null },
  };
  const signer = createNoopSigner(address(walletAddress));
  const instruction = await getRegisterArtworkInstructionAsync({
    registrationAuthority: signer,
    kathaId,
    artistId: identity.artistId,
    creatorWallet: null,
    category: ArtworkCategory.Paubha,
    creationYear: 2026,
    authorshipEvidenceHash: new Uint8Array(32).fill(0xee),
  });
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(signer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: 1000n,
          },
          msg,
        ),
      (msg) => appendTransactionMessageInstruction(instruction, msg),
    ),
  );
  const operation: UnsignedOperationResponse = {
    operationId: "dddddddd-1111-4111-8111-111111111111",
    preparationId: "eeeeeeee-1111-4111-8111-111111111111",
    kathaId,
    kind: "REGISTER_ARTWORK",
    cluster: "localnet",
    status: "PREPARED",
    requestHash: "a".repeat(64),
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
    transactionVersion: 0,
    feePayer: walletAddress,
    requiredSignerAddresses: [walletAddress],
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: "1000",
    simulation: { slot: "10", unitsConsumed: "200" },
  };
  return { page, operation };
}
