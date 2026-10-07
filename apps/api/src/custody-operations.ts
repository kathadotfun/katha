import {
  custodyPreparationRequestSchema,
  custodyAdministrationReviewSchema,
  physicalCustodyTransitionSchema,
  type Pagination,
  type ArtworkRegistrationReview,
  fulfillmentCreateRequestSchema,
  fulfillmentUpdateRequestSchema,
  fulfillmentResponseSchema,
} from "@katha/shared";
import type { CustodyOperationStore, FulfillmentRequestRecord } from "@katha/db";
import {
  buildInitializeCustodyTransaction,
  buildTransitionCustodyTransaction,
  type CustodyReader,
  type OperationChain,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import type { AuthorizationBoundary } from "./authorization.js";
import type { WalletSessionBoundary } from "./wallet-session.js";
import { createBlockchainOperations } from "./blockchain-operations.js";
import { DomainError } from "./errors.js";
export function createCustodyOperations(
  store: CustodyOperationStore,
  authorization: AuthorizationBoundary,
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  readChain: CustodyReader,
  chain: OperationChain,
  cluster: "localnet" | "devnet",
  readStatus: (kathaId: string) => Promise<ArtworkRegistrationReview["registration"]>,
) {
  async function read(kathaId: string, nextRevision?: bigint) {
    try {
      return await readChain(kathaId, nextRevision);
    } catch (error) {
      if (error instanceof TypeError) throw new DomainError("CONFLICT");
      throw error;
    }
  }
  function response(row: FulfillmentRequestRecord, kathaId: string) {
    // Explicit private projection; internal wallets, artwork UUID and chain intent are omitted.
    return fulfillmentResponseSchema.parse({
      id: row.id,
      kathaId,
      kind: row.kind,
      status: row.status,
      recipientName: row.recipientName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      addressLines: row.addressLines,
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      countryCode: row.countryCode,
      deliveryInstructions: row.deliveryInstructions,
      courier: row.courier,
      trackingReference: row.trackingReference,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async function session(bearer: string | undefined) {
    const wallet = await sessions.authenticate(bearer);
    if (wallet.cluster !== cluster) throw new DomainError("FORBIDDEN");
    return wallet;
  }
  return {
    async review(bearer: string | undefined, kathaId: string, pagination: Pagination) {
      const handler = await authorization.requireRole(bearer, "admin");
      if (handler.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const snapshot = await store.load(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const accounts = await read(kathaId);
      const [queue, custody] = await Promise.all([
        store.listRequests(snapshot.artwork.id, pagination),
        readStatus(kathaId),
      ]);
      const transitions = physicalCustodyTransitionSchema.options
        .map((option) =>
          option.parse({
            action: option.shape.action.value,
            from: option.shape.from.value,
            to: option.shape.to.value,
          }),
        )
        .filter(
          (t) =>
            t.from === accounts.custodyState &&
            !(
              t.to === "COLLECTOR_HELD" &&
              accounts.ownerWallet === accounts.configuration.custodyAuthority
            ),
        );
      return custodyAdministrationReviewSchema.parse({
        kathaId,
        title: snapshot.artwork.title,
        updatedAt: snapshot.artwork.updatedAt.toISOString(),
        cluster,
        chain: {
          revision: accounts.custodyRevision.toString(),
          state: accounts.custodyState,
          subject: accounts.custodySubject,
          ownerWallet: accounts.ownerWallet,
          custodyAuthority: accounts.configuration.custodyAuthority,
        },
        canAttest: handler.walletAddress === accounts.configuration.custodyAuthority,
        transitions,
        custody,
        requests: queue.items.map((row) => {
          const ownerMatches = row.requesterWallet === accounts.ownerWallet;
          const statuses = {
            REQUESTED: ["APPROVED", "CANCELLED"],
            APPROVED: ["DISPATCHED", "CANCELLED"],
            DISPATCHED: ["RECEIVED"],
            RECEIVED: [],
            CANCELLED: [],
          } as const;
          return {
            request: response(row, kathaId),
            ownerMatches,
            allowedStatuses: statuses[row.status].filter(
              (status) => ownerMatches || status === "CANCELLED",
            ),
            transitions: ownerMatches
              ? transitions.filter(
                  (t) =>
                    (row.status === "APPROVED" &&
                      t.action ===
                        (row.kind === "DELIVERY"
                          ? "DISPATCH_FROM_KATHA"
                          : "DISPATCH_FROM_COLLECTOR")) ||
                    (row.status === "DISPATCHED" &&
                      t.action ===
                        (row.kind === "DELIVERY"
                          ? "RECEIVE_BY_COLLECTOR"
                          : "RECEIVE_AT_KATHA")),
                )
              : [],
          };
        }),
        pagination: { ...pagination, hasMore: queue.hasMore },
      });
    },
    async prepare(bearer: string | undefined, kathaId: string, input: unknown) {
      const result = custodyPreparationRequestSchema.safeParse(input);
      if (!result.success) throw new DomainError("INVALID_REQUEST");
      const request = result.data;
      const authority = await authorization.requireRegistryAuthority(
        bearer,
        "custodyAuthority",
      );
      if (authority.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const snapshot = await store.load(kathaId, request.fulfillmentId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      if (snapshot.artwork.updatedAt.toISOString() !== request.expectedUpdatedAt)
        throw new DomainError("CONFLICT");
      if ((await readStatus(kathaId)).unresolved) throw new DomainError("CONFLICT");
      const expectedRevision = BigInt(request.expectedCustodyRevision);
      const accounts = await read(kathaId, expectedRevision + 1n);
      if (
        accounts.targetExists ||
        accounts.custodyRevision !== expectedRevision ||
        accounts.custodyState !== request.transition.from ||
        accounts.record.artistId !== snapshot.artwork.artistId ||
        accounts.record.creationYear !== snapshot.artwork.creationYear ||
        (accounts.record.creatorWallet.__option === "Some"
          ? accounts.record.creatorWallet.value
          : null) !== snapshot.artwork.creatorWallet ||
        Buffer.from(accounts.record.authorshipEvidenceHash).toString("hex") !==
          snapshot.artwork.authorshipEvidenceHash
      )
        throw new DomainError("CONFLICT");
      if (
        accounts.ownerWallet &&
        request.transition.to === "COLLECTOR_HELD" &&
        request.collectorWallet !== accounts.ownerWallet
      )
        throw new DomainError("CONFLICT");
      if (request.fulfillmentId) {
        const row = snapshot.request;
        if (
          !row ||
          !accounts.ownerWallet ||
          row.requesterWallet !== accounts.ownerWallet ||
          !(
            (row.status === "APPROVED" &&
              ((row.kind === "DELIVERY" &&
                request.transition.action === "DISPATCH_FROM_KATHA") ||
                (row.kind === "RETURN_TO_KATHA" &&
                  request.transition.action === "DISPATCH_FROM_COLLECTOR"))) ||
            (row.status === "DISPATCHED" &&
              ((row.kind === "DELIVERY" &&
                request.transition.action === "RECEIVE_BY_COLLECTOR") ||
                (row.kind === "RETURN_TO_KATHA" &&
                  request.transition.action === "RECEIVE_AT_KATHA")))
          )
        )
          throw new DomainError("CONFLICT");
      }
      return createBlockchainOperations(
        store.operations(snapshot),
        authorization,
        chain,
        cluster,
      ).prepare(
        bearer,
        {
          artworkId: snapshot.artwork.id,
          kathaId,
          kind: "UPDATE_CUSTODY",
          idempotencyKey: request.idempotencyKey,
          expectedAccounts: [
            KATHA_REGISTRY_PROGRAM_ADDRESS,
            authority.walletAddress,
            accounts.configAccount.address,
            accounts.artworkAccount.address,
            accounts.custodyHeadAccount.address,
            accounts.targetTransition,
            "11111111111111111111111111111111",
          ],
          expectedHashes: [],
          parameters: {
            expectedUpdatedAt: request.expectedUpdatedAt,
            expectedCustodyRevision: request.expectedCustodyRevision,
            transition: request.transition,
            collectorWallet: request.collectorWallet,
            movementConfirmed: true,
            fulfillmentId: request.fulfillmentId ?? null,
            fulfillmentUpdatedAt: snapshot.request?.updatedAt.toISOString() ?? null,
          },
        },
        new Set(request.supportedTransactionVersions),
        async (context) => {
          const data = {
            kathaId,
            transition: request.transition,
            collector: request.collectorWallet,
          };
          if (!accounts.custodyHeadAccount.exists)
            return buildInitializeCustodyTransaction(context, accounts, data);
          return buildTransitionCustodyTransaction(
            context,
            { ...accounts, custodyHeadAccount: accounts.custodyHeadAccount },
            { ...data, expectedRevision },
          );
        },
      );
    },
    async create(bearer: string | undefined, kathaId: string, input: unknown) {
      const wallet = await session(bearer);
      const parsed = fulfillmentCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const accounts = await read(kathaId);
      if (accounts.ownerWallet !== wallet.walletAddress)
        throw new DomainError("FORBIDDEN");
      if (
        (parsed.data.kind === "DELIVERY" && accounts.custodyState !== "KATHA_HELD") ||
        (parsed.data.kind === "RETURN_TO_KATHA" &&
          (accounts.custodyState !== "COLLECTOR_HELD" ||
            accounts.custodySubject !== wallet.walletAddress))
      )
        throw new DomainError("CONFLICT");
      const snapshot = await store.load(kathaId);
      if (!snapshot) throw new DomainError("NOT_FOUND");
      const row = await store.create(
        snapshot.artwork,
        wallet.walletAddress,
        parsed.data,
      );
      if (!row) throw new DomainError("CONFLICT");
      return response(row, kathaId);
    },
    async detail(bearer: string | undefined, id: string) {
      const wallet = await session(bearer);
      const found = await store.findRequest(id);
      if (!found) throw new DomainError("NOT_FOUND");
      if (found.request.requesterWallet !== wallet.walletAddress)
        await authorization.requireRole(bearer, "admin");
      return response(found.request, found.artwork.kathaId);
    },
    async update(bearer: string | undefined, id: string, input: unknown) {
      const handler = await authorization.requireRole(bearer, "admin");
      if (handler.cluster !== cluster) throw new DomainError("FORBIDDEN");
      const parsed = fulfillmentUpdateRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const found = await store.findRequest(id);
      if (!found) throw new DomainError("NOT_FOUND");
      if (parsed.data.status !== "CANCELLED") {
        const accounts = await read(found.artwork.kathaId);
        if (accounts.ownerWallet !== found.request.requesterWallet)
          throw new DomainError("CONFLICT");
      }
      const row = await store.update(found, handler.walletAddress, parsed.data);
      if (!row) throw new DomainError("CONFLICT");
      return response(row, found.artwork.kathaId);
    },
  };
}
export type CustodyOperationsBoundary = ReturnType<typeof createCustodyOperations>;
