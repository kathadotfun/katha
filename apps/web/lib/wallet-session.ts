import type {
  ArtworkVerificationRequest,
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
  type UnsignedOperationResponse,
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
    async reconcile(
      operation: UnsignedOperationResponse,
      wire: string,
      signal: AbortSignal,
    ) {
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
