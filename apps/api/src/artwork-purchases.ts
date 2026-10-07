import {
  canonicalDocumentBytes,
  sha256Hex,
  purchaseQuoteRequestSchema,
  purchasePrepareRequestSchema,
  purchaseQuoteTermsSchema,
  purchaseQuoteResponseSchema,
  purchasePreparationResponseSchema,
  chainOperationIntentSchema,
  type PurchaseQuoteTerms,
} from "@katha/shared";
import {
  readMarketplacePurchaseTerms,
  type MarketplacePurchaseReader,
} from "@katha/solana";
import {
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  parsePurchaseListingInstruction,
  identifyKathaMarketplaceInstruction,
  KathaMarketplaceInstruction,
} from "@katha/solana/marketplace";
import type { MarketplaceListingStore } from "@katha/db";
import type { WalletSessionBoundary } from "./wallet-session.js";
import type { PaymentProvider } from "./payment.js";
import { DomainError } from "./errors.js";
export function createArtworkPurchases(
  store: MarketplaceListingStore,
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  read: MarketplacePurchaseReader,
  payment: (mint: string) => PaymentProvider,
  cluster: "localnet" | "devnet",
) {
  async function review(
    bearer: string | undefined,
    kathaId: string,
    versions: readonly (0 | 1)[],
  ) {
    const session = await sessions.authenticate(bearer);
    if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
    const artwork = await store.load(kathaId);
    if (!artwork) throw new DomainError("NOT_FOUND");
    let snapshot;
    try {
      snapshot = await read(kathaId);
    } catch (cause) {
      throw new Error("Purchase state unavailable", { cause });
    }
    if (snapshot.state.artistId !== artwork.artistId) throw new DomainError("CONFLICT");
    let terms;
    try {
      terms = await readMarketplacePurchaseTerms(
        snapshot.accounts,
        kathaId,
        snapshot.chainTime,
      );
    } catch {
      throw new DomainError("CONFLICT");
    }
    if (
      [terms.seller, terms.artistPayout, terms.treasury].some(
        (wallet) => wallet === session.walletAddress,
      )
    )
      throw new DomainError("FORBIDDEN");
    const { paymentMint, ...sale } = terms;
    const quoteTerms: PurchaseQuoteTerms = purchaseQuoteTermsSchema.parse({
      schemaVersion: 1,
      kathaId,
      cluster,
      buyer: session.walletAddress,
      ...sale,
      payment: {
        kind: "DEVNET_TEST_TOKEN",
        paymentMint,
        decimals: 6,
        simulation: true,
        label: "Katha test token (no monetary value)",
      },
    });
    const quoteHash = await sha256Hex(canonicalDocumentBytes(quoteTerms));
    return { session, artwork, snapshot, quoteTerms, quoteHash, versions };
  }
  async function simulate(
    bearer: string | undefined,
    reviewed: Awaited<ReturnType<typeof review>>,
  ) {
    const provider = payment(reviewed.quoteTerms.payment.paymentMint);
    if (
      provider.description.cluster !== cluster ||
      provider.description.paymentMint !== reviewed.quoteTerms.payment.paymentMint ||
      provider.description.kind !== "DEVNET_TEST_TOKEN" ||
      provider.description.decimals !== 6 ||
      !provider.description.simulation
    )
      throw new DomainError("CONFLICT");
    const prepared = await provider.prepare(
      bearer,
      reviewed.snapshot,
      {
        kathaId: reviewed.quoteTerms.kathaId,
        expectedRevision: BigInt(reviewed.quoteTerms.revision),
        expectedPrice: reviewed.quoteTerms.price,
      },
      new Set(reviewed.versions),
    );
    if (
      prepared.walletId !== reviewed.session.walletId ||
      prepared.buyer !== reviewed.session.walletAddress ||
      prepared.cluster !== cluster ||
      prepared.paymentMint !== reviewed.quoteTerms.payment.paymentMint ||
      prepared.kathaId !== reviewed.quoteTerms.kathaId ||
      prepared.expectedRevision !== BigInt(reviewed.quoteTerms.revision) ||
      prepared.expectedPrice !== reviewed.quoteTerms.price ||
      prepared.nextRevision !== BigInt(reviewed.quoteTerms.revision) + 1n ||
      prepared.artifact.feePayer !== prepared.buyer ||
      prepared.artifact.requiredSignerAddresses.length !== 1 ||
      prepared.artifact.requiredSignerAddresses[0] !== prepared.buyer ||
      !reviewed.versions.includes(prepared.artifact.transactionVersion)
    )
      throw new DomainError("CONFLICT");
    if (
      identifyKathaMarketplaceInstruction(prepared.instruction.data) !==
      KathaMarketplaceInstruction.PurchaseListing
    )
      throw new DomainError("CONFLICT");
    const purchase = parsePurchaseListingInstruction(prepared.instruction);
    if (
      prepared.instruction.programAddress !== KATHA_MARKETPLACE_PROGRAM_ADDRESS ||
      purchase.accounts.buyer.address !== prepared.buyer ||
      purchase.accounts.asset.address !== reviewed.quoteTerms.asset ||
      purchase.accounts.listing.address !== reviewed.quoteTerms.listing ||
      purchase.accounts.seller.address !== reviewed.quoteTerms.seller ||
      purchase.accounts.paymentMint.address !== prepared.paymentMint ||
      purchase.data.expectedRevision !== prepared.expectedRevision ||
      purchase.data.expectedPrice !== BigInt(prepared.expectedPrice)
    )
      throw new DomainError("CONFLICT");
    const quote = purchaseQuoteResponseSchema.parse({
      ...reviewed.quoteTerms,
      quoteHash: reviewed.quoteHash,
      commitment: "finalized",
      observedSlot: reviewed.snapshot.observedSlot.toString(),
      chainTime: reviewed.snapshot.chainTime.toString(),
      simulation: prepared.artifact.simulation,
    });
    return { prepared, quote };
  }
  return {
    async quote(bearer: string | undefined, kathaId: string, input: unknown) {
      const request = purchaseQuoteRequestSchema.safeParse(input);
      if (!request.success) throw new DomainError("INVALID_REQUEST");
      const reviewed = await review(
        bearer,
        kathaId,
        request.data.supportedTransactionVersions,
      );
      return (await simulate(bearer, reviewed)).quote;
    },
    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const request = purchasePrepareRequestSchema.safeParse(input);
      if (!request.success) throw new DomainError("INVALID_REQUEST");
      const reviewed = await review(
        bearer,
        kathaId,
        request.data.supportedTransactionVersions,
      );
      if (request.data.quoteHash !== reviewed.quoteHash)
        throw new DomainError("CONFLICT");
      const { prepared, quote } = await simulate(bearer, reviewed),
        artifact = prepared.artifact,
        instruction = prepared.instruction;
      const expectedAccounts = [
        ...new Set([
          prepared.buyer,
          KATHA_MARKETPLACE_PROGRAM_ADDRESS,
          ...instruction.accounts.map((a) => a.address),
        ]),
      ].sort();
      const expectedHashes = [quote.quoteHash, quote.condition.hash];
      const intent = chainOperationIntentSchema.parse({
        artworkId: reviewed.artwork.id,
        kathaId,
        kind: "PURCHASE_ARTWORK",
        idempotencyKey: request.data.idempotencyKey,
        expectedAccounts,
        expectedHashes,
        parameters: { quote: reviewed.quoteTerms, quoteHash: quote.quoteHash },
      });
      const canonicalRequest = new TextDecoder().decode(
        canonicalDocumentBytes({
          schemaVersion: 1,
          ...intent,
          cluster,
          walletId: prepared.walletId,
          authorityWallet: prepared.buyer,
          feePayer: prepared.buyer,
          programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
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
      const requestHash = await sha256Hex(new TextEncoder().encode(canonicalRequest));
      const response = purchasePreparationResponseSchema.parse({
        ...artifact,
        operationId: "00000000-0000-4000-8000-000000000000",
        preparationId: "00000000-0000-4000-8000-000000000000",
        kathaId,
        kind: "PURCHASE_ARTWORK",
        cluster,
        status: "PREPARED",
        requestHash,
        lastValidBlockHeight: artifact.lastValidBlockHeight.toString(),
        quote,
        nextRevision: prepared.nextRevision.toString(),
      });
      const saved = await store.save(
        {
          artworkId: reviewed.artwork.id,
          walletId: prepared.walletId,
          cluster: cluster === "localnet" ? "LOCALNET" : "DEVNET",
          kind: "PURCHASE_ARTWORK",
          idempotencyKey: request.data.idempotencyKey,
          requestHash,
          programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
          expectedAccounts,
          expectedHashes,
        },
        prepared.buyer,
        kathaId,
        {
          canonicalRequest,
          messageHash: artifact.messageHash,
          transactionBase64: artifact.transactionBase64,
          transactionVersion: artifact.transactionVersion,
          blockhash: artifact.blockhash,
          lastValidBlockHeight: artifact.lastValidBlockHeight,
          simulationSlot: BigInt(artifact.simulation.slot),
          simulationUnits:
            artifact.simulation.unitsConsumed === null
              ? null
              : BigInt(artifact.simulation.unitsConsumed),
        },
      );
      if (saved.status !== "saved")
        throw new DomainError(saved.status === "not_found" ? "NOT_FOUND" : "CONFLICT");
      return purchasePreparationResponseSchema.parse({
        ...response,
        operationId: saved.operationId,
        preparationId: saved.preparationId,
      });
    },
  };
}
export type ArtworkPurchasesBoundary = ReturnType<typeof createArtworkPurchases>;
