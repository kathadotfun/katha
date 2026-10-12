import type { ResaleInspectionRequest } from "@katha/shared";
import type { PurchaseQuoteRequest, PurchasePrepareRequest } from "@katha/shared";
import type { ListingCreateRequest, ListingCancelRequest } from "@katha/shared";
import type { WalletOperation } from "./wallet-operation.ts";
import type { CollectorCollectionQuery } from "@katha/shared";
import type {
  MetadataRevisionDocumentRequest,
  MetadataRevisionRequest,
} from "@katha/shared";
import type { ArtworkMintRequest, ArtworkPublicationRequest } from "@katha/shared";
import type {
  ArtworkVerificationRequest,
  CustodyPreparationRequest,
  FulfillmentUpdateRequest,
  FulfillmentCreateRequest,
  FulfillmentReceiptRequest,
  FulfillmentCancellationRequest,
  ConditionPreparationRequest,
  ConditionAttestationRequest,
  ArtworkRegistrationRequest,
} from "@katha/shared";
import type { ArtworkMediaUpload, ArtworkMediaUpdate } from "@katha/shared";
import {
  walletSessionResponseSchema,
  type WalletSession,
  type ArtistCreateRequest,
  type Pagination,
  type ArtworkDraftCreateRequest,
  type ArtworkDraftUpdateRequest,
} from "@katha/shared";
import type { WalletConnection } from "./wallet-connection.ts";
import { WalletSessionApiError, type WalletSessionApi } from "./wallet-session-api.ts";

export type WalletSessionSnapshot = Readonly<{
  status: "signed-out" | "signing-in" | "signed-in";
  session: WalletSession | null;
  error: string | null;
}>;
export const signedOutSnapshot: WalletSessionSnapshot = {
  status: "signed-out",
  session: null,
  error: null,
};

// A bearer token stays in this closure. Account-scoped data subscribes to this
// store, so identity changes remove authority before any pending request completes.
export function createWalletSession(
  connection: WalletConnection,
  api: WalletSessionApi,
  origin: string,
  now = Date.now,
) {
  let snapshot = signedOutSnapshot;
  let token: string | null = null;
  let generation = 0;
  let disposed = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const identity = () => {
    const state = connection.getSnapshot();
    return state.status === "connected" && state.connected
      ? `${state.connected.walletId}:${state.connected.address}`
      : null;
  };
  let currentIdentity = identity();
  function publish(value: WalletSessionSnapshot) {
    snapshot = value;
    for (const listener of listeners) listener();
  }
  async function revoke(value: string, version: number) {
    try {
      await api.logout(value);
    } catch {
      if (!disposed && generation === version)
        publish({
          ...snapshot,
          error:
            "Signed out here. Server revocation could not be confirmed; the previous session expires automatically.",
        });
    }
  }
  function clear() {
    generation++;
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    timer = undefined;
    const previous = token;
    token = null;
    publish(signedOutSnapshot);
    if (previous) void revoke(previous, generation);
  }
  const unsubscribe = connection.subscribe(() => {
    const next = identity();
    if (next !== currentIdentity) {
      currentIdentity = next;
      clear();
    }
  });
  async function authorized<T>(
    request: (value: string) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (
      disposed ||
      !token ||
      !snapshot.session ||
      Date.parse(snapshot.session.expiresAt) <= now() ||
      signal.aborted
    )
      throw new WalletSessionApiError("UNAUTHENTICATED");
    const version = generation;
    let result: T | undefined;
    let failure: WalletSessionApiError["code"] = "UNAVAILABLE";
    try {
      result = await request(token);
    } catch (error) {
      if (error instanceof WalletSessionApiError) {
        failure = error.code;
        if (error.code === "UNAUTHENTICATED" && version === generation) clear();
      }
    }
    if (
      disposed ||
      version !== generation ||
      signal.aborted ||
      !snapshot.session ||
      Date.parse(snapshot.session.expiresAt) <= now()
    )
      throw new WalletSessionApiError("UNAUTHENTICATED");
    if (result === undefined) throw new WalletSessionApiError(failure);
    return result;
  }
  return {
    async readResale(kathaId: string, signal: AbortSignal, verifier = false) {
      const page = await authorized(
        (token) => api.readResale(kathaId, token, signal, verifier),
        signal,
      );
      if (
        page.cluster !== snapshot.session?.cluster ||
        (!verifier && page.ownerWallet !== snapshot.session?.walletAddress)
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return page;
    },
    async requestResale(
      kathaId: string,
      input: ResaleInspectionRequest,
      signal: AbortSignal,
    ) {
      const page = await authorized(
        (token) => api.requestResale(kathaId, input, token, signal),
        signal,
      );
      if (
        page.cluster !== snapshot.session?.cluster ||
        page.ownerWallet !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return page;
    },
    async readDelivery(kathaId: string, pagination: Pagination, signal: AbortSignal) {
      const page = await authorized(
        (token) => api.readDelivery(kathaId, pagination, token, signal),
        signal,
      );
      if (
        page.ownerWallet !== snapshot.session?.walletAddress ||
        page.cluster !== snapshot.session?.cluster
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return page;
    },
    createDelivery(
      kathaId: string,
      input: FulfillmentCreateRequest,
      signal: AbortSignal,
    ) {
      return authorized(
        (token) => api.createDelivery(kathaId, input, token, signal),
        signal,
      );
    },
    cancelDelivery(
      id: string,
      input: FulfillmentCancellationRequest,
      signal: AbortSignal,
    ) {
      return authorized(
        (token) => api.cancelDelivery(id, input, token, signal),
        signal,
      );
    },
    reportDeliveryReceipt(
      id: string,
      input: FulfillmentReceiptRequest,
      signal: AbortSignal,
    ) {
      return authorized(
        (token) => api.reportDeliveryReceipt(id, input, token, signal),
        signal,
      );
    },
    async preparePurchase(
      kathaId: string,
      input: PurchasePrepareRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.preparePurchase(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress ||
        result.quote.buyer !== snapshot.session?.walletAddress ||
        result.quote.cluster !== result.cluster
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readPurchaseQuote(
      kathaId: string,
      input: PurchaseQuoteRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.readPurchaseQuote(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.buyer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareCancellation(
      kathaId: string,
      input: ListingCancelRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareCancellation(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareListing(
      kathaId: string,
      input: ListingCreateRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareListing(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readCollection(query: CollectorCollectionQuery, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readCollection(query, value, signal),
        signal,
      );
      if (
        result.walletAddress !== snapshot.session?.walletAddress ||
        result.cluster !== snapshot.session?.cluster
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readAccount(signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readAccount(value, signal),
        signal,
      );
      if (
        result.session.walletAddress !== snapshot.session?.walletAddress ||
        result.session.walletId !== snapshot.session?.walletId ||
        result.session.cluster !== snapshot.session?.cluster ||
        result.session.expiresAt !== snapshot.session?.expiresAt ||
        Date.parse(result.session.expiresAt) <= now()
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readMetadataRevisions(kathaId: string, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readMetadataRevisions(kathaId, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async saveMetadataRevisionDocument(
      kathaId: string,
      input: MetadataRevisionDocumentRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.saveMetadataRevisionDocument(kathaId, input, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareMetadataRevision(
      kathaId: string,
      input: MetadataRevisionRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareMetadataRevision(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readMinting(kathaId: string, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readMinting(kathaId, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareMint(kathaId: string, input: ArtworkMintRequest, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.prepareMint(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async publishArtwork(
      kathaId: string,
      input: ArtworkPublicationRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.publishArtwork(kathaId, input, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readCustody(kathaId: string, pagination: Pagination, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readCustody(kathaId, pagination, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    updateFulfillment(
      id: string,
      input: FulfillmentUpdateRequest,
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.updateFulfillment(id, input, value, signal),
        signal,
      );
    },
    async prepareCustody(
      kathaId: string,
      input: CustodyPreparationRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareCustody(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readCondition(kathaId: string, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readCondition(kathaId, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    prepareConditionDocument(
      kathaId: string,
      input: ConditionPreparationRequest,
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.prepareConditionDocument(kathaId, input, value, signal),
        signal,
      );
    },
    async uploadConditionEvidence(
      kathaId: string,
      updatedAt: string,
      file: File,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.uploadConditionEvidence(kathaId, updatedAt, file, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareConditionAttestation(
      kathaId: string,
      input: ConditionAttestationRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareConditionAttestation(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readVerification(kathaId: string, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readVerification(kathaId, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async prepareVerification(
      kathaId: string,
      input: ArtworkVerificationRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareVerification(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async readRegistration(kathaId: string, signal: AbortSignal) {
      const result = await authorized(
        (value) => api.readRegistration(kathaId, value, signal),
        signal,
      );
      if (result.cluster !== snapshot.session?.cluster)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    prepareMetadata(kathaId: string, expectedUpdatedAt: string, signal: AbortSignal) {
      return authorized(
        (value) => api.prepareMetadata(kathaId, expectedUpdatedAt, value, signal),
        signal,
      );
    },
    async prepareRegistration(
      kathaId: string,
      input: ArtworkRegistrationRequest,
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.prepareRegistration(kathaId, input, value, signal),
        signal,
      );
      if (
        result.cluster !== snapshot.session?.cluster ||
        result.feePayer !== snapshot.session?.walletAddress
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    readArtworkMedia(kathaId: string, signal: AbortSignal) {
      return authorized(
        (value) => api.readArtworkMedia(kathaId, value, signal),
        signal,
      );
    },
    uploadArtworkMedia(
      kathaId: string,
      input: ArtworkMediaUpload,
      file: File,
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.uploadArtworkMedia(kathaId, input, file, value, signal),
        signal,
      );
    },
    updateArtworkMedia(
      kathaId: string,
      input: ArtworkMediaUpdate,
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.updateArtworkMedia(kathaId, input, value, signal),
        signal,
      );
    },
    assignNfcTag(kathaId: string, tagId: string, signal: AbortSignal) {
      return authorized(
        (value) => api.assignNfcTag(kathaId, tagId, value, signal),
        signal,
      );
    },
    listNfcTags(kathaId: string, signal: AbortSignal) {
      return authorized((value) => api.listNfcTags(kathaId, value, signal), signal);
    },
    readArtworkWorkflow(
      kathaId: string,
      role: "admin" | "verifier",
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.readArtworkWorkflow(kathaId, role, value, signal),
        signal,
      );
    },
    readNfcTag(tagId: string, signal: AbortSignal) {
      return authorized((value) => api.readNfcTag(tagId, value, signal), signal);
    },
    retireNfcTag(tagId: string, signal: AbortSignal) {
      return authorized((value) => api.retireNfcTag(tagId, value, signal), signal);
    },
    readArtworkDraft(kathaId: string, signal: AbortSignal) {
      return authorized(
        (value) => api.readArtworkDraft(kathaId, value, signal),
        signal,
      );
    },
    createArtworkDraft(input: ArtworkDraftCreateRequest, signal: AbortSignal) {
      return authorized(
        (value) => api.createArtworkDraft(input, value, signal),
        signal,
      );
    },
    updateArtworkDraft(
      kathaId: string,
      input: ArtworkDraftUpdateRequest,
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.updateArtworkDraft(kathaId, input, value, signal),
        signal,
      );
    },
    listArtworkDrafts(page: Pagination, signal: AbortSignal) {
      return authorized((value) => api.listArtworkDrafts(page, value, signal), signal);
    },
    async permissions(signal: AbortSignal) {
      const result = await authorized(
        (value) => api.permissions(value, signal),
        signal,
      );
      if (
        result.session.walletAddress !== snapshot.session?.walletAddress ||
        result.session.walletId !== snapshot.session?.walletId ||
        result.session.cluster !== snapshot.session?.cluster ||
        Date.parse(result.session.expiresAt) <= now()
      )
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    createArtist(input: ArtistCreateRequest, signal: AbortSignal) {
      return authorized((value) => api.createArtist(input, value, signal), signal);
    },
    searchArtists(
      query: string,
      page: Pagination,
      role: "admin" | "verifier",
      signal: AbortSignal,
    ) {
      return authorized(
        (value) => api.searchArtists(query, page, role, value, signal),
        signal,
      );
    },
    readArtist(artistId: string, signal: AbortSignal) {
      return authorized((value) => api.readArtist(artistId, value, signal), signal);
    },
    async verifyArtist(
      artistId: string,
      input: { confirmed: true },
      signal: AbortSignal,
    ) {
      const result = await authorized(
        (value) => api.verifyArtist(artistId, input, value, signal),
        signal,
      );
      if (result.verifiedByWallet !== snapshot.session?.walletAddress)
        throw new WalletSessionApiError("UNAVAILABLE");
      return result;
    },
    async reconcile(operation: WalletOperation, wire: string, signal: AbortSignal) {
      if (
        disposed ||
        !token ||
        !snapshot.session ||
        Date.parse(snapshot.session.expiresAt) <= now() ||
        snapshot.session.walletAddress !== operation.feePayer ||
        snapshot.session.cluster !== operation.cluster
      )
        throw new Error("Sign in with the operation wallet.");
      const version = generation;
      let result: Awaited<ReturnType<WalletSessionApi["receipt"]>> | undefined;
      try {
        result = await api.receipt(operation, wire, token, signal);
      } catch (error) {
        if (error instanceof WalletSessionApiError && error.code === "UNAUTHENTICATED")
          clear();
      }
      if (!result) throw new Error("Receipt reconciliation could not complete.");
      if (disposed || version !== generation || signal.aborted)
        throw new Error("Wallet session changed.");
      return result;
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async signIn() {
      if (disposed || !currentIdentity || snapshot.status !== "signed-out") return;
      const connected = connection.getSnapshot().connected!;
      const version = ++generation;
      const abort = new AbortController();
      controller = abort;
      publish({ status: "signing-in", session: null, error: null });
      try {
        const challenge = await api.challenge(
          { walletAddress: connected.address, cluster: connection.cluster },
          abort.signal,
        );
        if (version !== generation || disposed) return;
        const signature = await connection.signLoginChallenge(
          challenge,
          origin,
          abort.signal,
        );
        if (version !== generation || disposed) return;
        const response = walletSessionResponseSchema.parse(
          await api.verify(
            {
              challengeId: challenge.challengeId,
              walletAddress: connected.address,
              signature,
            },
            abort.signal,
          ),
        );
        if (version !== generation || disposed) {
          void revoke(response.token, -1);
          return;
        }
        const remaining = Date.parse(response.session.expiresAt) - now();
        if (
          response.session.walletAddress !== connected.address ||
          response.session.cluster !== connection.cluster ||
          remaining <= 0 ||
          remaining > 24 * 60 * 60_000
        ) {
          void revoke(response.token, -1);
          throw new Error("Mismatched wallet session.");
        }
        token = response.token;
        publish({ status: "signed-in", session: response.session, error: null });
        timer = setTimeout(clear, remaining);
      } catch {
        if (version === generation && !disposed)
          publish({
            status: "signed-out",
            session: null,
            error:
              "Sign-in was not completed. Check the network and wallet, then try again.",
          });
      } finally {
        if (version === generation) controller = null;
      }
    },
    signOut() {
      if (!disposed) clear();
    },
    dispose() {
      disposed = true;
      unsubscribe();
      clear();
      listeners.clear();
    },
  };
}
export type WalletSessionController = ReturnType<typeof createWalletSession>;
