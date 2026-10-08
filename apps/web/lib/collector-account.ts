import {
  collectorAccountResponseSchema,
  type CollectorAccountResponse,
} from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
export type AccountSnapshot = Readonly<{
  status: "locked" | "loading" | "ready" | "unavailable";
  account: CollectorAccountResponse | null;
}>;
export const lockedAccountSnapshot: AccountSnapshot = {
  status: "locked",
  account: null,
};
export function createCollectorAccount(
  session: Pick<WalletSessionController, "getSnapshot" | "subscribe" | "readAccount">,
) {
  let state = lockedAccountSnapshot;
  let generation = 0;
  let disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot();
    return auth.status === "signed-in" && auth.session
      ? JSON.stringify(auth.session)
      : null;
  };
  let current = identity();
  function publish(value: AccountSnapshot) {
    state = value;
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      publish(lockedAccountSnapshot);
    }
  });
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      if (disposed || !current || state.status === "loading") return;
      const version = ++generation;
      abort = new AbortController();
      const signal = abort.signal;
      publish({ status: "loading", account: null });
      try {
        const account = collectorAccountResponseSchema.parse(
          await session.readAccount(signal),
        );
        if (disposed || signal.aborted || generation !== version) return;
        const expected = session.getSnapshot().session;
        if (
          !expected ||
          account.session.walletId !== expected.walletId ||
          account.session.walletAddress !== expected.walletAddress ||
          account.session.cluster !== expected.cluster ||
          account.session.expiresAt !== expected.expiresAt
        )
          throw new Error("Account identity changed");
        publish({ status: "ready", account });
      } catch {
        if (!disposed && !signal.aborted && generation === version)
          publish({ status: "unavailable", account: null });
      }
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = lockedAccountSnapshot;
    },
  };
}
export type CollectorAccount = ReturnType<typeof createCollectorAccount>;
