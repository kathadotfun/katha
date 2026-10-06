import {
  getBase64Encoder,
  getBase64Decoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
  assertIsTransactionWithinSizeLimit,
  getSignatureFromTransaction,
  getPublicKeyFromAddress,
  verifySignature,
  address,
  unwrapOption,
} from "@solana/kit";
import {
  unsignedOperationResponseSchema,
  sha256Hex,
  registrationIdentitySchema,
  type RegistrationIdentity,
  type UnsignedOperationResponse,
} from "@katha/shared";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  identifyKathaRegistryInstruction,
  KathaRegistryInstruction,
  ArtworkCategory,
  parseKathaRegistryInstruction,
  findArtworkPda,
  findConfigPda,
} from "@katha/solana/registry";

const kinds: Record<
  UnsignedOperationResponse["kind"],
  readonly KathaRegistryInstruction[]
> = {
  REGISTER_ARTWORK: [KathaRegistryInstruction.RegisterArtwork],
  VERIFY_ARTWORK: [KathaRegistryInstruction.VerifyArtwork],
  RECORD_CONDITION: [
    KathaRegistryInstruction.InitializeCondition,
    KathaRegistryInstruction.RecordUnmintedCondition,
    KathaRegistryInstruction.RecordMintedCondition,
  ],
  UPDATE_CUSTODY: [
    KathaRegistryInstruction.InitializeCustody,
    KathaRegistryInstruction.TransitionCustody,
  ],
  MINT_ARTWORK: [KathaRegistryInstruction.MintArtwork],
  REVISE_METADATA: [
    KathaRegistryInstruction.InitializeMetadata,
    KathaRegistryInstruction.ReviseUnmintedMetadata,
    KathaRegistryInstruction.ReviseMintedMetadata,
  ],
};
export function decodeCanonicalTransaction(wire: string) {
  const bytes = getBase64Encoder().encode(wire);
  if (getBase64Decoder().decode(bytes) !== wire)
    throw new Error("Noncanonical transaction.");
  const transaction = getTransactionDecoder().decode(bytes);
  assertIsTransactionWithinSizeLimit(transaction);
  if (getBase64Decoder().decode(getTransactionEncoder().encode(transaction)) !== wire)
    throw new Error("Invalid transaction bytes.");
  return transaction;
}
export async function inspectPreparedTransaction(
  input: unknown,
  context: {
    wallet: string;
    cluster: "localnet" | "devnet";
    kind: UnsignedOperationResponse["kind"];
    kathaId: string;
    registration?: RegistrationIdentity;
  },
) {
  const operation = unsignedOperationResponseSchema.parse(input);
  const transaction = decodeCanonicalTransaction(operation.transactionBase64);
  const compiled = getCompiledTransactionMessageDecoder().decode(
    transaction.messageBytes,
  );
  const message = decompileTransactionMessage(compiled);
  const instruction = message.instructions[0];
  if (!("blockhash" in message.lifetimeConstraint))
    throw new Error("Recent blockhash required.");
  if (
    operation.cluster !== context.cluster ||
    operation.kind !== context.kind ||
    operation.kathaId !== context.kathaId ||
    operation.feePayer !== context.wallet ||
    operation.requiredSignerAddresses[0] !== context.wallet ||
    Object.keys(transaction.signatures).length !== 1 ||
    Object.keys(transaction.signatures)[0] !== context.wallet ||
    Object.values(transaction.signatures).some((value) => value !== null) ||
    compiled.version !== operation.transactionVersion ||
    (context.cluster === "localnet" && compiled.version !== 0) ||
    message.feePayer.address !== context.wallet ||
    message.lifetimeConstraint.blockhash !== operation.blockhash ||
    (await sha256Hex(Uint8Array.from(transaction.messageBytes))) !==
      operation.messageHash ||
    message.instructions.length !== 1 ||
    !instruction?.data ||
    instruction.programAddress !== KATHA_REGISTRY_PROGRAM_ADDRESS ||
    !kinds[operation.kind].includes(identifyKathaRegistryInstruction(instruction.data))
  )
    throw new Error("Preparation does not match the requested operation.");
  const parsed = parseKathaRegistryInstruction({
    ...instruction,
    data: instruction.data,
  });
  const [[artwork], [config]] = await Promise.all([
    findArtworkPda({ kathaId: operation.kathaId }),
    findConfigPda(),
  ]);
  if (
    !("artwork" in parsed.accounts) ||
    !("config" in parsed.accounts) ||
    parsed.accounts.artwork.address !== artwork ||
    parsed.accounts.config.address !== config ||
    (parsed.instructionType === KathaRegistryInstruction.RegisterArtwork &&
      parsed.data.kathaId !== operation.kathaId)
  )
    throw new Error("Registry artwork identity mismatch.");
  if (context.registration) {
    const expected = registrationIdentitySchema.parse(context.registration);
    const categories = {
      MANDALA: ArtworkCategory.Mandala,
      PAUBHA: ArtworkCategory.Paubha,
      THANGKA: ArtworkCategory.Thangka,
    };
    if (
      parsed.instructionType !== KathaRegistryInstruction.RegisterArtwork ||
      parsed.data.artistId !== expected.artistId ||
      unwrapOption(parsed.data.creatorWallet) !== expected.creatorWallet ||
      parsed.data.category !== categories[expected.category] ||
      parsed.data.creationYear !== expected.creationYear ||
      Array.from(parsed.data.authorshipEvidenceHash, (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("") !== expected.authorshipEvidenceHash
    )
      throw new Error("Registration attribution mismatch.");
  }
  return {
    operation,
    transaction: {
      ...transaction,
      lifetimeConstraint: {
        blockhash: message.lifetimeConstraint.blockhash,
        lastValidBlockHeight: BigInt(operation.lastValidBlockHeight),
      },
    },
    accounts: (instruction.accounts ?? []).map((account) => ({
      address: String(account.address),
      role: account.role,
    })),
    program: String(instruction.programAddress),
  };
}
export async function validateSignedTransaction(
  wire: string,
  operation: UnsignedOperationResponse,
) {
  const signed = decodeCanonicalTransaction(wire);
  const prepared = decodeCanonicalTransaction(operation.transactionBase64);
  const wallet = address(operation.feePayer);
  const bytes = signed.signatures[wallet];
  if (
    Object.keys(signed.signatures).length !== 1 ||
    !bytes ||
    signed.messageBytes.length !== prepared.messageBytes.length ||
    !signed.messageBytes.every(
      (byte, index) => byte === prepared.messageBytes[index],
    ) ||
    !(await verifySignature(
      await getPublicKeyFromAddress(wallet),
      bytes,
      signed.messageBytes,
    ))
  )
    throw new Error("Wallet changed or did not sign the prepared transaction.");
  return getSignatureFromTransaction(signed);
}
