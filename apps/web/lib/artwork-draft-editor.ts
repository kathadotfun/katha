import {
  artworkDraftCreateRequestSchema,
  artworkDraftUpdateRequestSchema,
  type ArtworkDraftReadResponse,
} from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";
export type DraftEditorSnapshot = Readonly<{
  status: "locked" | "ready" | "denied" | "unavailable";
  busy: boolean;
  record: ArtworkDraftReadResponse | null;
  reloadRequired: boolean;
  error: string | null;
  saved: boolean;
}>;
export const lockedDraftEditorSnapshot: DraftEditorSnapshot = {
  status: "locked",
  busy: false,
  record: null,
  reloadRequired: false,
  error: null,
  saved: false,
};
export function createArtworkDraftEditor(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readArtworkDraft"
    | "createArtworkDraft"
    | "updateArtworkDraft"
  >,
) {
  let state = lockedDraftEditorSnapshot;
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
  function publish(value: DraftEditorSnapshot) {
    state = value;
    for (const listener of listeners) listener();
  }
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      publish(lockedDraftEditorSnapshot);
    }
  });
  async function run(
    action: "check" | "read" | "create" | "save",
    request: (signal: AbortSignal) => Promise<ArtworkDraftReadResponse | null>,
  ) {
    if (disposed || !current || state.busy) return;
    if (action === "save" && (!state.record?.editable || state.reloadRequired)) return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({
      ...state,
      busy: true,
      saved: false,
      error: null,
      ...(action === "read" ? { record: null } : {}),
    });
    try {
      const permissions = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!permissions.admin) {
        publish({
          ...lockedDraftEditorSnapshot,
          status: "denied",
          error: "An administrator wallet is required to document artworks.",
        });
        return;
      }
      const result = await request(signal);
      if (disposed || signal.aborted || version !== generation) return;
      publish({
        ...lockedDraftEditorSnapshot,
        status: "ready",
        record: result,
        saved: action === "create" || action === "save",
      });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      const denied = code === "FORBIDDEN" || code === "UNAUTHENTICATED";
      const uncertain = action === "save" && ["CONFLICT", "UNAVAILABLE"].includes(code);
      const messages = {
        CONFLICT:
          action === "create"
            ? "This creation request already exists. Review the draft list before creating another physical artwork record."
            : "The draft changed or editing has closed. Reload and review the current record before saving.",
        UNAVAILABLE:
          action === "create"
            ? "Creation could not be confirmed. Keep the same request ID and check the draft list before retrying."
            : "The request could not be confirmed. Reload the current draft before retrying a save.",
        NOT_FOUND: "The artwork or artist was not found. Check the identifier.",
        INVALID_REQUEST:
          "The server rejected these fields. Check the artwork documentation.",
        FORBIDDEN: "This wallet no longer has administration access.",
        UNAUTHENTICATED: "Your session changed or expired. Sign in again.",
      };
      publish({
        ...state,
        busy: false,
        ...(denied
          ? { status: "denied" as const, record: null }
          : action === "read" || action === "check"
            ? { status: "unavailable" as const }
            : {}),
        reloadRequired: state.reloadRequired || uncertain,
        error: messages[code],
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
    check: () => run("check", async () => null),
    read: (kathaId: string) =>
      run("read", (signal) => session.readArtworkDraft(kathaId, signal)),
    create(input: unknown) {
      const parsed = artworkDraftCreateRequestSchema.safeParse(input);
      if (!parsed.success || state.record) return Promise.resolve();
      return run("create", async (signal) => ({
        artwork: await session.createArtworkDraft(parsed.data, signal),
        editable: true,
      }));
    },
    save(input: unknown) {
      const parsed = artworkDraftUpdateRequestSchema.safeParse(input);
      const previous = state.record?.artwork;
      if (
        !parsed.success ||
        !previous ||
        parsed.data.expectedUpdatedAt !== previous.updatedAt
      )
        return Promise.resolve();
      return run("save", async (signal) => {
        const artwork = await session.updateArtworkDraft(
          previous.kathaId,
          parsed.data,
          signal,
        );
        if (
          artwork.id !== previous.id ||
          artwork.artistId !== previous.artistId ||
          artwork.category !== previous.category ||
          artwork.creationYear !== previous.creationYear ||
          artwork.creatorWallet !== previous.creatorWallet ||
          artwork.createdAt !== previous.createdAt ||
          (previous.authorshipEvidenceHash !== null &&
            artwork.authorshipEvidenceHash !== previous.authorshipEvidenceHash)
        )
          throw new WalletSessionApiError("UNAVAILABLE");
        return { artwork, editable: true };
      });
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = lockedDraftEditorSnapshot;
    },
  };
}
export type ArtworkDraftEditor = ReturnType<typeof createArtworkDraftEditor>;
