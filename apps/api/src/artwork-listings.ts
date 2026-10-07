import {
  canonicalDocumentBytes,
  sha256Hex,
  listingCreateRequestSchema,
  listingCancelRequestSchema,
  listingPreparationResponseSchema,
  artworkListingResponseSchema,
  chainOperationIntentSchema,
} from "@katha/shared";
import {
  buildCreateListingTransaction,
  buildCancelListingTransaction,
  encodeUnsignedRegistryTransaction,
  OperationSimulationError,
  type MarketplaceListingReader,
  type OperationChain,
} from "@katha/solana";
import {
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  ListingStatus,
  SaleKind,
} from "@katha/solana/marketplace";
import type { MarketplaceListingStore } from "@katha/db";
import type { WalletSessionBoundary } from "./wallet-session.js";
import { DomainError } from "./errors.js";
export function createArtworkListings(
  store: MarketplaceListingStore,
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  read: MarketplaceListingReader,
  chain: OperationChain,
  cluster: "localnet" | "devnet",
) {
  async function load(kathaId: string) {
    const artwork = await store.load(kathaId);
    if (!artwork) throw new DomainError("NOT_FOUND");
    let snapshot;
    try {
      snapshot = await read(kathaId);
    } catch (error) {
      throw new Error("Listing state unavailable", { cause: error });
    }
    if (snapshot.state.artistId !== artwork.artistId) throw new DomainError("CONFLICT");
    return { artwork, snapshot };
  }
  async function prepare(
    bearer: string | undefined,
    kathaId: string,
    input: unknown,
    cancel: boolean,
  ) {
    const request = (
      cancel ? listingCancelRequestSchema : listingCreateRequestSchema
    ).safeParse(input);
    if (!request.success) throw new DomainError("INVALID_REQUEST");
    const creation = cancel ? null : listingCreateRequestSchema.parse(input);
    const session = await sessions.authenticate(bearer);
    if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
    const { artwork, snapshot } = await load(kathaId);
    if (snapshot.state.owner !== session.walletAddress)
      throw new DomainError("FORBIDDEN");
    let context;
    try {
      context = await chain.context(
        session.walletAddress,
        new Set(request.data.supportedTransactionVersions),
      );
    } catch (error) {
      throw new Error("Listing preparation unavailable", { cause: error });
    }
    if (
      context.cluster !== cluster ||
      context.authorityAddress !== session.walletAddress ||
      context.feePayerAddress !== session.walletAddress
    )
      throw new DomainError("CONFLICT");
    let prepared;
    try {
      prepared = cancel
        ? await buildCancelListingTransaction(
            { ...context, chainTime: snapshot.chainTime },
            snapshot.accounts,
            { kathaId, expectedRevision: BigInt(request.data.expectedRevision) },
          )
        : await buildCreateListingTransaction(
            { ...context, chainTime: snapshot.chainTime },
            snapshot.accounts,
            {
              kathaId,
              expectedRevision: BigInt(request.data.expectedRevision),
              price: creation!.price,
              expiresAt: BigInt(creation!.expiresAt),
            },
          );
    } catch (error) {
      if (error instanceof TypeError) throw new DomainError("CONFLICT");
      throw error;
    }
    const instruction = prepared.instruction;
    const expectedAccounts = [
      ...new Set([
        session.walletAddress,
        KATHA_MARKETPLACE_PROGRAM_ADDRESS,
        ...instruction.accounts.map((value) => value.address),
      ]),
    ].sort();
    const intent = chainOperationIntentSchema.parse({
      artworkId: artwork.id,
      kathaId,
      kind: cancel ? "CANCEL_LISTING" : "CREATE_LISTING",
      idempotencyKey: request.data.idempotencyKey,
      expectedAccounts,
      expectedHashes: [],
      parameters: cancel
        ? { expectedRevision: request.data.expectedRevision }
        : {
            expectedRevision: request.data.expectedRevision,
            price: creation!.price,
            expiresAt: creation!.expiresAt,
          },
    });
    const canonicalRequest = new TextDecoder().decode(
      canonicalDocumentBytes({
        schemaVersion: 1,
        ...intent,
        cluster,
        walletId: session.walletId,
        authorityWallet: session.walletAddress,
        feePayer: session.walletAddress,
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
    const encoded = await encodeUnsignedRegistryTransaction(prepared);
    let artifact;
    try {
      artifact = await chain.simulate(prepared);
    } catch (error) {
      if (error instanceof OperationSimulationError && error.code === "REJECTED")
        throw new DomainError("CONFLICT");
      throw new Error("Listing preparation unavailable", { cause: error });
    }
    for (const key of [
      "transactionBase64",
      "messageHash",
      "transactionVersion",
      "feePayer",
      "blockhash",
      "lastValidBlockHeight",
    ] as const)
      if (artifact[key] !== encoded[key]) throw new DomainError("CONFLICT");
    if (
      artifact.requiredSignerAddresses.length !== 1 ||
      artifact.requiredSignerAddresses[0] !== session.walletAddress
    )
      throw new DomainError("CONFLICT");
    const price = cancel ? snapshot.state.ledger!.price.toString() : creation!.price;
    const expiresAt = cancel
      ? snapshot.state.ledger!.expiresAt.toString()
      : creation!.expiresAt;
    const response = listingPreparationResponseSchema.parse({
      ...artifact,
      operationId: "00000000-0000-4000-8000-000000000000",
      preparationId: "00000000-0000-4000-8000-000000000000",
      kathaId,
      kind: intent.kind,
      cluster,
      status: "PREPARED",
      requestHash,
      lastValidBlockHeight: artifact.lastValidBlockHeight.toString(),
      currentRevision: request.data.expectedRevision,
      nextRevision: prepared.nextRevision.toString(),
      price,
      expiresAt,
    });
    const saved = await store.save(
      {
        artworkId: artwork.id,
        walletId: session.walletId,
        cluster: cluster === "localnet" ? "LOCALNET" : "DEVNET",
        kind: intent.kind,
        idempotencyKey: request.data.idempotencyKey,
        requestHash,
        programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS,
        expectedAccounts,
        expectedHashes: [],
      },
      session.walletAddress,
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
    return listingPreparationResponseSchema.parse({
      ...response,
      operationId: saved.operationId,
      preparationId: saved.preparationId,
    });
  }
  return {
    async get(kathaId: string) {
      const { snapshot } = await load(kathaId),
        { state } = snapshot,
        ledger = state.ledger;
      return artworkListingResponseSchema.parse({
        kathaId,
        cluster,
        commitment: "finalized",
        observedSlot: snapshot.observedSlot.toString(),
        chainTime: snapshot.chainTime.toString(),
        owner: state.owner,
        asset: state.asset,
        currentRevision: state.revision.toString(),
        listing: ledger
          ? {
              address: state.listing,
              status: {
                [ListingStatus.Inactive]: "INACTIVE",
                [ListingStatus.Active]: "ACTIVE",
                [ListingStatus.Cancelled]: "CANCELLED",
                [ListingStatus.Expired]: "EXPIRED",
                [ListingStatus.Purchased]: "PURCHASED",
              }[ledger.status],
              revision: ledger.revision.toString(),
              completedSales: ledger.completedSales.toString(),
              saleKind: ledger.saleKind === SaleKind.Primary ? "PRIMARY" : "SECONDARY",
              seller: ledger.seller,
              paymentMint: ledger.paymentMint,
              decimals: 6,
              price: ledger.price.toString(),
              createdAt: ledger.createdAt.toString(),
              expiresAt: ledger.expiresAt.toString(),
              active: state.active,
            }
          : null,
      });
    },
    prepareListing: (bearer: string | undefined, kathaId: string, input: unknown) =>
      prepare(bearer, kathaId, input, false),
    prepareCancellation: (
      bearer: string | undefined,
      kathaId: string,
      input: unknown,
    ) => prepare(bearer, kathaId, input, true),
  };
}
export type ArtworkListingsBoundary = ReturnType<typeof createArtworkListings>;
