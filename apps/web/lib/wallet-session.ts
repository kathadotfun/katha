import { walletSessionResponseSchema, type WalletSession } from "@katha/shared";
import type { WalletConnection } from "./wallet-connection.ts";
import type { WalletSessionApi } from "./wallet-session-api.ts";

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
  return {
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
