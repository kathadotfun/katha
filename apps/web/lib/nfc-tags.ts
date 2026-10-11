import { nfcTagIdSchema, type NfcTagResponse } from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";

// A tag reference is a URL identifier, not a hardware UID or authenticity proof.
export type NfcSnapshot = Readonly<{
  busy: "assign" | "lookup" | "retire" | null;
  tag: NfcTagResponse | null;
  result: "assigned" | "lookup" | "retired" | null;
  error: string | null;
}>;
export const emptyNfcSnapshot: NfcSnapshot = {
  busy: null,
  tag: null,
  result: null,
  error: null,
};

const messages: Record<WalletSessionApiError["code"], string> = {
  UNAUTHENTICATED: "Your session changed or expired. Sign in again.",
  FORBIDDEN: "This wallet doesn't have the administrator role needed for tags.",
  CONFLICT:
    "That tag can't be assigned. It may already be bound to an artwork, or retired.",
  NOT_FOUND: "No tag or artwork matches that reference.",
  INVALID_REQUEST: "Katha rejected that tag reference. Check it and try again.",
  UNAVAILABLE:
    "The tag service couldn't confirm the result. Look the tag up before retrying.",
};

export function parseTagId(value: string): string | null {
  const parsed = nfcTagIdSchema.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}

export function createNfcTags(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "assignNfcTag" | "readNfcTag" | "retireNfcTag"
  >,
  kathaId: string,
) {
  let state = emptyNfcSnapshot,
    generation = 0,
    disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => JSON.stringify(session.getSnapshot().session);
  let current = identity();
  const publish = (next: NfcSnapshot) => {
    state = next;
    for (const fn of listeners) fn();
  };
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      publish(emptyNfcSnapshot);
    }
  });
  async function run(
    busy: NonNullable<NfcSnapshot["busy"]>,
    result: NonNullable<NfcSnapshot["result"]>,
    action: (signal: AbortSignal) => Promise<NfcTagResponse>,
  ) {
    if (disposed || state.busy || !session.getSnapshot().session) return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({ ...state, busy, error: null });
    try {
      const tag = await action(signal);
      if (disposed || signal.aborted || version !== generation) return;
      publish({ busy: null, tag, result, error: null });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      publish({ ...state, busy: null, error: messages[code] });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    assign(value: string) {
      const tagId = parseTagId(value);
      if (!tagId) {
        publish({
          ...state,
          error: "Enter the tag reference printed on the tag, in UUID form.",
        });
        return Promise.resolve();
      }
      return run("assign", "assigned", (signal) =>
        session.assignNfcTag(kathaId, tagId, signal),
      );
    },
    lookup(value: string) {
      const tagId = parseTagId(value);
      if (!tagId) {
        publish({
          ...state,
          error: "Enter the tag reference printed on the tag, in UUID form.",
        });
        return Promise.resolve();
      }
      return run("lookup", "lookup", (signal) => session.readNfcTag(tagId, signal));
    },
    retire() {
      const tag = state.tag;
      // Only an active binding to this artwork can be retired from its workspace.
      if (!tag || tag.kathaId !== kathaId || tag.state !== "ACTIVE")
        return Promise.resolve();
      return run("retire", "retired", (signal) =>
        session.retireNfcTag(tag.tagId, signal),
      );
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = emptyNfcSnapshot;
    },
  };
}
export type NfcTags = ReturnType<typeof createNfcTags>;
