import {
  artworkMediaUploadSchema,
  artworkMediaUpdateSchema,
  type ArtworkMediaResponse,
} from "@katha/shared";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
export type MediaSnapshot = Readonly<{
  status: "locked" | "ready" | "denied" | "unavailable";
  page: ArtworkMediaResponse | null;
  busy: boolean;
  reloadRequired: boolean;
  error: string | null;
  saved: boolean;
}>;
export const lockedMediaSnapshot: MediaSnapshot = {
  status: "locked",
  page: null,
  busy: false,
  reloadRequired: false,
  error: null,
  saved: false,
};
export function createArtworkMediaManager(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readArtworkMedia"
    | "uploadArtworkMedia"
    | "updateArtworkMedia"
  >,
  kathaId: string,
) {
  let state = lockedMediaSnapshot;
  let generation = 0;
  let disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot();
    return auth.status === "signed-in" && auth.session
      ? `${auth.session.walletId}:${auth.session.walletAddress}:${auth.session.cluster}:${auth.session.expiresAt}`
      : null;
  };
  let current = identity();
  function publish(value: MediaSnapshot) {
    state = value;
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (current !== next) {
      current = next;
      generation++;
      abort?.abort();
      publish(lockedMediaSnapshot);
    }
  });
  async function run(
    write: boolean,
    request: (signal: AbortSignal) => Promise<ArtworkMediaResponse>,
  ) {
    if (
      disposed ||
      !current ||
      state.busy ||
      (write && (!state.page?.editable || state.reloadRequired))
    )
      return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({
      ...state,
      busy: true,
      error: null,
      saved: false,
      ...(write ? {} : { page: null }),
    });
    try {
      const permissions = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!permissions.admin) {
        publish({
          ...lockedMediaSnapshot,
          status: "denied",
          error: "An administrator wallet is required to manage artwork media.",
        });
        return;
      }
      const page = await request(signal);
      if (disposed || signal.aborted || version !== generation) return;
      publish({ ...lockedMediaSnapshot, status: "ready", page, saved: write });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      const denied = code === "FORBIDDEN" || code === "UNAUTHENTICATED";
      publish({
        ...state,
        busy: false,
        ...(denied
          ? { status: "denied" as const, page: null }
          : write
            ? {}
            : { status: "unavailable" as const }),
        reloadRequired:
          state.reloadRequired || (write && ["CONFLICT", "UNAVAILABLE"].includes(code)),
        error: denied
          ? "Access changed or expired. Sign in with an administrator wallet."
          : code === "INVALID_REQUEST"
            ? "Check the file type, 8 MiB size limit, image description and public approval."
            : code === "NOT_FOUND"
              ? "Artwork not found. Check the permanent Katha ID."
              : "The media request could not be confirmed. Reload before retrying; an upload may already be saved.",
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
    read: () => run(false, (signal) => session.readArtworkMedia(kathaId, signal)),
    upload(input: unknown, file: File) {
      const parsed = artworkMediaUploadSchema.safeParse(input);
      if (!parsed.success || parsed.data.expectedUpdatedAt !== state.page?.updatedAt)
        return Promise.resolve();
      return run(true, (signal) =>
        session.uploadArtworkMedia(kathaId, parsed.data, file, signal),
      );
    },
    update(input: unknown) {
      const parsed = artworkMediaUpdateSchema.safeParse(input);
      if (!parsed.success || parsed.data.expectedUpdatedAt !== state.page?.updatedAt)
        return Promise.resolve();
      return run(true, (signal) =>
        session.updateArtworkMedia(kathaId, parsed.data, signal),
      );
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = lockedMediaSnapshot;
    },
  };
}
export type ArtworkMediaManager = ReturnType<typeof createArtworkMediaManager>;
