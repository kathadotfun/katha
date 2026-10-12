import {
  address,
  type Address,
  assertIsTransactionWithinSizeLimit,
  getTransactionDecoder,
  getTransactionEncoder,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
  getSignatureFromTransaction,
} from "@solana/kit";
import { sha256Hex, listingPriceSchema, kathaIdSchema } from "@katha/shared";
import { fetchMaybeToken, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  associatedTokens,
  buildPurchaseListingTransaction,
  type MarketplacePurchaseAccounts,
  type MarketplacePurchaseInput,
} from "./marketplace.js";
import {
  encodeUnsignedRegistryTransaction,
  type OperationChain,
} from "./operation-preparation.js";
import {
  ReceiptValidationError,
  type OperationReceiptReader,
  type ReceiptObservation,
} from "./operation-receipt.js";
import { verifyWalletSignature } from "./wallet-signature.js";
import {
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  identifyKathaMarketplaceInstruction,
  KathaMarketplaceInstruction,
  parsePurchaseListingInstruction,
} from "./generated/marketplace/index.js";
import { findArtworkPda } from "./generated/registry/index.js";
import {
  createKathaRpcClient,
  type KathaRpcConfig,
  type WalletTransactionVersion,
} from "./client.js";

export interface PaymentArtworkState {
  /** Server-fetched snapshots and chain clock; never browser-supplied accounts. */
  accounts: MarketplacePurchaseAccounts;
  chainTime: bigint;
}
export type PaymentPurchaseInput = Omit<
  MarketplacePurchaseInput,
  "buyerAddress" | "paymentMintAddress"
>;
// The buyer's canonical payment-token account is missing or holds less than the price.
export class PaymentFundsError extends Error {
  constructor() {
    super("Buyer payment balance is insufficient");
    this.name = "PaymentFundsError";
  }
}
/** Null means the owner has no canonical token account for the mint. */
export type PaymentBalanceReader = (
  owner: Address,
  mint: Address,
) => Promise<bigint | null>;
export function createPaymentBalanceReader(
  config: KathaRpcConfig,
): PaymentBalanceReader {
  const { rpc } = createKathaRpcClient(config);
  return async (owner, mint) => {
    const account = await fetchMaybeToken(rpc, await associatedTokens(owner, mint), {
      commitment: "confirmed",
      abortSignal: AbortSignal.timeout(10_000),
    });
    if (!account.exists) return null;
    if (
      account.programAddress !== TOKEN_PROGRAM_ADDRESS ||
      account.data.owner !== owner ||
      account.data.mint !== mint
    )
      throw new TypeError("Unexpected payment token account");
    return account.data.amount;
  };
}
export class PaymentValidationError extends Error {
  constructor() {
    super("Payment operation does not match preparation");
  }
}
const wire = (input: string) => {
  if (typeof input !== "string" || input.length > 5464)
    throw new PaymentValidationError();
  const bytes = Buffer.from(input, "base64");
  if (bytes.toString("base64") !== input) throw new PaymentValidationError();
  const tx = getTransactionDecoder().decode(bytes);
  assertIsTransactionWithinSizeLimit(tx);
  if (!Buffer.from(getTransactionEncoder().encode(tx)).equals(bytes))
    throw new PaymentValidationError();
  return tx;
};
export interface PaymentPreparation {
  cluster: "localnet" | "devnet";
  paymentMint: string;
  buyer: string;
  kathaId: string;
  expectedRevision: bigint;
  expectedPrice: string;
  artifact: Awaited<ReturnType<OperationChain["simulate"]>>;
  instruction: Awaited<
    ReturnType<typeof buildPurchaseListingTransaction>
  >["instruction"];
  nextRevision: bigint;
}

/** Test-token settlement is one Marketplace CPI transaction, never a second payment. */
export function createMarketplacePaymentSettlement(
  chain: OperationChain,
  readReceipt: OperationReceiptReader,
  config: { cluster: "localnet" | "devnet"; paymentMint: string },
  readBalance?: PaymentBalanceReader,
) {
  if (config.cluster !== "localnet" && config.cluster !== "devnet")
    throw new PaymentValidationError();
  const mint = address(config.paymentMint),
    cluster = config.cluster;
  return {
    config: Object.freeze({ cluster, paymentMint: mint }),
    async prepare(
      buyer: string,
      versions: ReadonlySet<WalletTransactionVersion>,
      state: PaymentArtworkState,
      input: PaymentPurchaseInput,
    ): Promise<PaymentPreparation> {
      const wallet = address(buyer);
      const context = await chain.context(wallet, versions);
      if (
        context.cluster !== cluster ||
        context.authorityAddress !== wallet ||
        context.feePayerAddress !== wallet
      )
        throw new PaymentValidationError();
      // A short balance is a buyer problem, not an unavailable listing; say so
      // before simulation turns it into a generic rejection.
      if (readBalance) {
        const balance = await readBalance(wallet, mint);
        if (
          balance === null ||
          balance < BigInt(listingPriceSchema.parse(input.expectedPrice))
        )
          throw new PaymentFundsError();
      }
      const prepared = await buildPurchaseListingTransaction(
        { ...context, chainTime: state.chainTime },
        state.accounts,
        { ...input, buyerAddress: wallet, paymentMintAddress: mint },
      );
      const encoded = await encodeUnsignedRegistryTransaction(prepared);
      const artifact = await chain.simulate(prepared);
      // Simulation must describe precisely the bytes the buyer will review/sign.
      for (const key of [
        "transactionBase64",
        "messageHash",
        "transactionVersion",
        "feePayer",
        "blockhash",
        "lastValidBlockHeight",
      ] as const)
        if (artifact[key] !== encoded[key]) throw new PaymentValidationError();
      if (
        artifact.requiredSignerAddresses.length !== 1 ||
        artifact.requiredSignerAddresses[0] !== wallet
      )
        throw new PaymentValidationError();
      return {
        cluster,
        paymentMint: mint,
        buyer: wallet,
        kathaId: input.kathaId,
        expectedRevision: input.expectedRevision,
        expectedPrice: input.expectedPrice,
        artifact,
        instruction: prepared.instruction,
        nextRevision: prepared.nextRevision,
      };
    },
    async verify(
      buyer: string,
      prepared: PaymentPreparation,
      signedWire: string,
    ): Promise<ReceiptObservation> {
      let transactionSignature: string;
      try {
        const wallet = address(buyer),
          artifact = prepared.artifact;
        if (
          prepared.cluster !== cluster ||
          prepared.paymentMint !== mint ||
          prepared.buyer !== wallet
        )
          throw new PaymentValidationError();
        const unsigned = wire(artifact.transactionBase64),
          signed = wire(signedWire);
        const signers = Object.keys(signed.signatures);
        if (
          signers.length !== 1 ||
          signers[0] !== wallet ||
          Object.values(unsigned.signatures).some((value) => value !== null) ||
          !Buffer.from(unsigned.messageBytes).equals(
            Buffer.from(signed.messageBytes),
          ) ||
          (await sha256Hex(Uint8Array.from(signed.messageBytes))) !==
            artifact.messageHash
        )
          throw new PaymentValidationError();
        const signedBytes = signed.signatures[wallet];
        if (
          !signedBytes ||
          !(await verifyWalletSignature(
            wallet,
            Uint8Array.from(signed.messageBytes),
            Uint8Array.from(signedBytes),
          ))
        )
          throw new PaymentValidationError();
        const compiled = getCompiledTransactionMessageDecoder().decode(
          signed.messageBytes,
        );
        if (
          compiled.version !== artifact.transactionVersion ||
          (compiled.version !== 0 && compiled.version !== 1) ||
          (cluster === "localnet" && compiled.version !== 0)
        )
          throw new PaymentValidationError();
        const message = decompileTransactionMessage(compiled),
          ix = message.instructions[0];
        if (
          message.feePayer.address !== wallet ||
          message.instructions.length !== 1 ||
          ix?.programAddress !== KATHA_MARKETPLACE_PROGRAM_ADDRESS ||
          !ix.data ||
          identifyKathaMarketplaceInstruction(ix.data) !==
            KathaMarketplaceInstruction.PurchaseListing
        )
          throw new PaymentValidationError();
        const purchase = parsePurchaseListingInstruction({
          ...ix,
          accounts: ix.accounts ?? [],
          data: ix.data,
        });
        const [artwork] = await findArtworkPda({
          kathaId: kathaIdSchema.parse(prepared.kathaId),
        });
        if (
          purchase.accounts.buyer.address !== wallet ||
          purchase.accounts.paymentMint.address !== mint ||
          purchase.accounts.artwork.address !== artwork ||
          purchase.data.expectedRevision !== prepared.expectedRevision ||
          purchase.data.expectedPrice !==
            BigInt(listingPriceSchema.parse(prepared.expectedPrice))
        )
          throw new PaymentValidationError();
        transactionSignature = getSignatureFromTransaction(signed);
      } catch {
        throw new PaymentValidationError();
      }
      try {
        // Reader pins RPC genesis, reads finalized bytes and checks transaction error.
        return await readReceipt(transactionSignature, signedWire);
      } catch (error) {
        if (error instanceof ReceiptValidationError) throw new PaymentValidationError();
        return { status: "UNKNOWN" };
      }
    },
  };
}
export type MarketplacePaymentSettlement = ReturnType<
  typeof createMarketplacePaymentSettlement
>;
