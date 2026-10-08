import {
  collectorCollectionResponseSchema,
  artworkListingResponseSchema,
  HTTP_LIMITS,
  type CollectorCollectionResponse,
  type ArtworkListingResponse,
} from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
export type CollectionSnapshot = Readonly<{
  identity: string | null;
  status: "locked" | "loading" | "ready" | "unavailable";
  page: CollectorCollectionResponse | null;
  listings: Readonly<Record<string, ArtworkListingResponse | null>>;
}>;
export const lockedCollectionSnapshot: CollectionSnapshot = {
  identity: null,
  status: "locked",
  page: null,
  listings: {},
};
export const collectionIdentity = (
  session: ReturnType<WalletSessionController["getSnapshot"]>["session"],
) => (session ? JSON.stringify(session) : null);
export function createCollectorCollection(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "readCollection"
  >,
  readListing: (id: string, signal: AbortSignal) => Promise<ArtworkListingResponse>,
) {
  let state = lockedCollectionSnapshot;
  let generation = 0,
    offset = 0;
  let disposed = false;
  let abort: AbortController | null = null;
  const limit = 20;
  const listeners = new Set<() => void>();
  const identity = () =>
    session.getSnapshot().status === "signed-in"
      ? collectionIdentity(session.getSnapshot().session)
      : null;
  let current = identity();
  function publish(next: CollectionSnapshot) {
    state = next;
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      offset = 0;
      abort?.abort();
      publish(lockedCollectionSnapshot);
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
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    offset = nextOffset;
    publish({ identity: current, status: "loading", page: null, listings: {} });
    try {
      const page = collectorCollectionResponseSchema.parse(
        await session.readCollection({ limit, offset }, signal),
      );
      if (disposed || signal.aborted || version !== generation) return;
      const auth = session.getSnapshot().session;
      if (
        !auth ||
        page.walletAddress !== auth.walletAddress ||
        page.cluster !== auth.cluster ||
        page.pagination.limit !== limit ||
        page.pagination.offset !== offset ||
        new Set(page.items.map((item) => item.artwork.kathaId)).size !==
          page.items.length ||
        new Set(page.items.map((item) => item.assetAddress)).size !== page.items.length
      )
        throw new Error("Invalid collection scope");
      publish({ identity: current, status: "ready", page, listings: {} });
      await Promise.all(
        page.items.map(async (item) => {
          let listing: ArtworkListingResponse | null = null;
          try {
            const value = artworkListingResponseSchema.parse(
              await readListing(item.artwork.kathaId, signal),
            );
            if (
              value.kathaId !== item.artwork.kathaId ||
              value.asset !== item.assetAddress ||
              value.cluster !== page.cluster
            )
              throw new Error("Invalid listing binding");
            listing = value;
          } catch {
            /* Public listing observations can fail independently of indexed holdings. */
          }
          if (!disposed && !signal.aborted && version === generation)
            publish({
              ...state,
              listings: { ...state.listings, [item.artwork.kathaId]: listing },
            });
        }),
      );
    } catch {
      if (!disposed && !signal.aborted && version === generation)
        publish({ identity: current, status: "unavailable", page: null, listings: {} });
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
    refresh: () => load(offset),
    next: () =>
      state.page?.pagination.hasMore ? load(offset + limit) : Promise.resolve(),
    previous: () => load(Math.max(0, offset - limit)),
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = lockedCollectionSnapshot;
    },
  };
}
export type CollectorCollection = ReturnType<typeof createCollectorCollection>;
