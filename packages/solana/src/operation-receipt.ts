import { assertKathaRpcCluster } from "./rpc-cluster.js";
import {
  sha256Hex,
  canonicalDocumentBytes,
  chainOperationIntentSchema,
  preparedInstructionSchema,
} from "@katha/shared";
import {
  address,
  assertIsTransactionWithinSizeLimit,
  getTransactionDecoder,
  getTransactionEncoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
  getSignatureFromTransaction,
  signature,
  type GetTransactionApi,
  type GetGenesisHashApi,
  type Rpc,
} from "@solana/kit";
import { verifyWalletSignature } from "./wallet-signature.js";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  identifyKathaRegistryInstruction,
  KathaRegistryInstruction,
} from "./generated/registry/index.js";
import {
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  identifyKathaMarketplaceInstruction,
  KathaMarketplaceInstruction,
} from "./generated/marketplace/index.js";
const marketplaceKinds: Record<string, readonly KathaMarketplaceInstruction[]> = {
  CREATE_LISTING: [
    KathaMarketplaceInstruction.CreateListing,
    KathaMarketplaceInstruction.CreateListingWithFees,
  ],
  CANCEL_LISTING: [KathaMarketplaceInstruction.CancelListing],
  PURCHASE_ARTWORK: [KathaMarketplaceInstruction.PurchaseListing],
};
export class ReceiptValidationError extends Error {
  constructor() {
    super("Receipt does not match preparation");
  }
}
const bytes = (value: string) => {
  if (value.length > 5464) throw new ReceiptValidationError();
  const data = Buffer.from(value, "base64");
  if (data.toString("base64") !== value) throw new ReceiptValidationError();
  return data;
};
const wire = (value: string) => {
  const data = bytes(value),
    tx = getTransactionDecoder().decode(data);
  assertIsTransactionWithinSizeLimit(tx);
  if (!Buffer.from(getTransactionEncoder().encode(tx)).equals(data))
    throw new ReceiptValidationError();
  return tx;
};
export interface ReceiptPreparation {
  transactionBase64: string;
  messageHash: string;
  transactionVersion: number;
  canonicalRequest: string;
  requestHash: string;
  wallet: string;
  walletId: string;
  cluster: "localnet" | "devnet";
  kind: string;
  artworkId: string;
  idempotencyKey: string;
  programAddress: string;
  expectedAccounts: string[];
  expectedHashes: string[];
}
const kinds: Record<string, readonly KathaRegistryInstruction[]> = {
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
export async function validateSignedPreparation(
  signedWire: string,
  expected: ReceiptPreparation,
) {
  try {
    const tx = wire(signedWire),
      prepared = wire(expected.transactionBase64);
    const wallet = address(expected.wallet),
      signers = Object.keys(tx.signatures);
    if (
      signers.length !== 1 ||
      signers[0] !== wallet ||
      Object.values(prepared.signatures).some((v) => v !== null) ||
      !Buffer.from(tx.messageBytes).equals(Buffer.from(prepared.messageBytes)) ||
      (await sha256Hex(Uint8Array.from(tx.messageBytes))) !== expected.messageHash
    )
      throw new ReceiptValidationError();
    const signed = tx.signatures[wallet];
    if (
      !signed ||
      !(await verifyWalletSignature(
        wallet,
        Uint8Array.from(tx.messageBytes),
        Uint8Array.from(signed),
      ))
    )
      throw new ReceiptValidationError();
    const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    if (
      compiled.version !== expected.transactionVersion ||
      (compiled.version !== 0 && compiled.version !== 1) ||
      (expected.cluster === "localnet" && compiled.version !== 0)
    )
      throw new ReceiptValidationError();
    const message = decompileTransactionMessage(compiled);
    const instruction = message.instructions[0];
    const canonical: unknown = JSON.parse(expected.canonicalRequest);
    if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical))
      throw new ReceiptValidationError();
    const record = canonical as Record<string, unknown>;
    const {
      schemaVersion,
      cluster,
      walletId,
      authorityWallet,
      feePayer,
      programAddress,
      instruction: bound,
      ...intentInput
    } = record;
    const intent = chainOperationIntentSchema.parse(intentInput);
    const isMarketplace = Object.hasOwn(marketplaceKinds, intent.kind);
    const expectedProgram = isMarketplace
      ? KATHA_MARKETPLACE_PROGRAM_ADDRESS
      : KATHA_REGISTRY_PROGRAM_ADDRESS;
    if (
      (await sha256Hex(new TextEncoder().encode(expected.canonicalRequest))) !==
        expected.requestHash ||
      new TextDecoder().decode(canonicalDocumentBytes(canonical)) !==
        expected.canonicalRequest ||
      schemaVersion !== 1 ||
      cluster !== expected.cluster ||
      walletId !== expected.walletId ||
      authorityWallet !== wallet ||
      feePayer !== wallet ||
      programAddress !== expected.programAddress ||
      programAddress !== expectedProgram ||
      intent.artworkId !== expected.artworkId ||
      intent.kind !== expected.kind ||
      intent.idempotencyKey !== expected.idempotencyKey ||
      JSON.stringify(intent.expectedAccounts) !==
        JSON.stringify(expected.expectedAccounts) ||
      JSON.stringify(intent.expectedHashes) !== JSON.stringify(expected.expectedHashes)
    )
      throw new ReceiptValidationError();
    if (
      !instruction ||
      message.instructions.length !== 1 ||
      message.feePayer.address !== wallet ||
      instruction.programAddress !== programAddress ||
      !instruction.data ||
      !(isMarketplace
        ? marketplaceKinds[intent.kind]?.includes(
            identifyKathaMarketplaceInstruction(instruction.data),
          )
        : kinds[intent.kind]?.includes(
            identifyKathaRegistryInstruction(instruction.data),
          ))
    )
      throw new ReceiptValidationError();
    const accounts = [
      ...new Set([
        wallet,
        instruction.programAddress,
        ...(instruction.accounts ?? []).map((a) => a.address),
      ]),
    ].sort();
    if (JSON.stringify(accounts) !== JSON.stringify(expected.expectedAccounts))
      throw new ReceiptValidationError();
    const boundInstruction = preparedInstructionSchema.parse(bound);
    // Compilation merges duplicate roles and makes the fee payer writable/signing.
    const roles = new Map<string, number>([
      [wallet, 3],
      [instruction.programAddress, 0],
    ]);
    for (const account of boundInstruction.accounts)
      roles.set(account.address, (roles.get(account.address) ?? 0) | account.role);
    if (
      boundInstruction.programAddress !== programAddress ||
      boundInstruction.dataHex !== Buffer.from(instruction.data).toString("hex") ||
      JSON.stringify(boundInstruction.accounts.map((a) => a.address)) !==
        JSON.stringify((instruction.accounts ?? []).map((a) => a.address)) ||
      (instruction.accounts ?? []).some((a) => a.role !== roles.get(a.address))
    )
      throw new ReceiptValidationError();
    return {
      signature: getSignatureFromTransaction(tx),
      messageHash: expected.messageHash,
    };
  } catch {
    throw new ReceiptValidationError();
  }
}
export type ReceiptObservation =
  | { status: "UNKNOWN" }
  | { status: "FAILED"; failureCode: "TRANSACTION_FAILED" }
  | { status: "FINALIZED"; slot: bigint; chainRecordedAt: Date };
export function createOperationReceiptReaderFromRpc(
  rpc: Rpc<GetTransactionApi & GetGenesisHashApi>,
  cluster: KathaRpcConfig["cluster"],
) {
  return async (
    transactionSignature: string,
    signedWire: string,
  ): Promise<ReceiptObservation> => {
    const signal = AbortSignal.timeout(10000);
    const genesis = await rpc.getGenesisHash().send({ abortSignal: signal });
    try {
      assertKathaRpcCluster(genesis, cluster);
    } catch {
      throw new ReceiptValidationError();
    }
    const result = await rpc
      .getTransaction(signature(transactionSignature), {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 1,
      })
      .send({ abortSignal: signal });
    if (!result) return { status: "UNKNOWN" };
    if (result.transaction[1] !== "base64") throw new ReceiptValidationError();
    try {
      const tx = wire(result.transaction[0]),
        expected = wire(signedWire);
      if (
        getSignatureFromTransaction(tx) !== transactionSignature ||
        !Buffer.from(tx.messageBytes).equals(Buffer.from(expected.messageBytes)) ||
        !Buffer.from(bytes(result.transaction[0])).equals(bytes(signedWire)) ||
        result.version !==
          getCompiledTransactionMessageDecoder().decode(tx.messageBytes).version
      )
        throw new ReceiptValidationError();
    } catch {
      // Malformed or unsigned RPC bytes are a mismatch, not a network outage.
      throw new ReceiptValidationError();
    }
    if (!result.meta || result.meta.err === undefined) return { status: "UNKNOWN" };
    if (
      typeof result.slot !== "bigint" ||
      result.slot < 0n ||
      result.slot > 0x7fff_ffff_ffff_ffffn
    )
      return { status: "UNKNOWN" };
    if (result.meta.err !== null) {
      if (typeof result.meta.err !== "string" && typeof result.meta.err !== "object")
        return { status: "UNKNOWN" };
      return { status: "FAILED", failureCode: "TRANSACTION_FAILED" };
    }
    if (
      typeof result.slot !== "bigint" ||
      result.slot < 0n ||
      result.slot > 0x7fff_ffff_ffff_ffffn ||
      result.blockTime === null
    )
      return { status: "UNKNOWN" };
    const seconds = result.blockTime;
    if (typeof seconds !== "bigint" || seconds < 0n || seconds > 8640000000000n)
      return { status: "UNKNOWN" };
    const chainRecordedAt = new Date(Number(seconds) * 1000);
    if (
      !Number.isFinite(chainRecordedAt.getTime()) ||
      chainRecordedAt.getTime() > Date.now()
    )
      return { status: "UNKNOWN" };
    return { status: "FINALIZED", slot: result.slot, chainRecordedAt };
  };
}
export function createOperationReceiptReader(config: KathaRpcConfig) {
  return createOperationReceiptReaderFromRpc(
    createKathaRpcClient(config).rpc,
    config.cluster,
  );
}
export type OperationReceiptReader = ReturnType<typeof createOperationReceiptReader>;
