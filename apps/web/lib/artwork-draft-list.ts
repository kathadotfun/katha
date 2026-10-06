import { HTTP_LIMITS, type ArtworkDraftListResponse } from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";
export type DraftListSnapshot = Readonly<{
  status: "locked" | "loading" | "ready" | "denied" | "unavailable";
  page: ArtworkDraftListResponse | null;
  error: string | null;
}>;
export const lockedDraftListSnapshot: DraftListSnapshot = {
  status: "locked",
  page: null,
  error: null,
};
export function createArtworkDraftList(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "permissions" | "listArtworkDrafts"
  >,
) {
  let state = lockedDraftListSnapshot;
  let generation = 0;
  let disposed = false;
  let abort: AbortController | null = null;
  let offset = 0;
  const limit = 20;
  const listeners = new Set<() => void>();
  const identity = () => {
    const value = session.getSnapshot();
    return value.status === "signed-in" && value.session
      ? `${value.session.walletId}:${value.session.walletAddress}:${value.session.cluster}:${value.session.expiresAt}`
      : null;
  };
  let current = identity();
  function publish(value: DraftListSnapshot) {
    state = value;
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      offset = 0;
      publish(lockedDraftListSnapshot);
    }
  });
  async function load(nextOffset = offset) {
    if (
      disposed ||
      !current ||
      state.status === "loading" ||
      !Number.isSafeInteger(nextOffset) ||
      nextOffset < 0 ||
      nextOffset > HTTP_LIMITS.offset
    )
      return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    offset = nextOffset;
    publish({ status: "loading", page: null, error: null });
    try {
      const permissions = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!permissions.admin) {
        publish({
          status: "denied",
          page: null,
          error: "An administrator wallet is required to view artwork drafts.",
        });
        return;
      }
      const page = await session.listArtworkDrafts({ limit, offset }, signal);
      if (disposed || signal.aborted || version !== generation) return;
      publish({ status: "ready", page, error: null });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const denied =
        error instanceof WalletSessionApiError &&
        ["FORBIDDEN", "UNAUTHENTICATED"].includes(error.code);
      publish({
        status: denied ? "denied" : "unavailable",
        page: null,
        error: denied
          ? "Access is no longer available. Sign in with an authorized administrator wallet."
          : "Artwork drafts could not be loaded. Check the API connection and try again.",
      });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    refresh: () => load(0),
    previous: () => load(Math.max(0, offset - limit)),
    next() {
      if (state.page?.pagination.hasMore && offset + limit <= HTTP_LIMITS.offset)
        return load(offset + limit);
      return Promise.resolve();
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = lockedDraftListSnapshot;
    },
  };
}
export type ArtworkDraftList = ReturnType<typeof createArtworkDraftList>;
