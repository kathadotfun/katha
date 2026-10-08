import {
  resaleInspectionReviewSchema,
  resaleInspectionRequestSchema,
  type ResaleInspectionReview,
} from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
export const emptyResaleSnapshot = {
  page: null as ResaleInspectionReview | null,
  busy: false,
  error: null as string | null,
};
export function createResaleWorkflow(
  session: Pick<
    WalletSessionController,
    "getSnapshot" | "subscribe" | "readResale" | "requestResale"
  >,
  kathaId: string,
  verifier = false,
) {
  let state = emptyResaleSnapshot,
    disposed = false,
    generation = 0,
    abort: AbortController | null = null,
    requestId = crypto.randomUUID();
  const listeners = new Set<() => void>();
  const identity = () => JSON.stringify(session.getSnapshot().session);
  let current = identity();
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };
  const unsubscribe = session.subscribe(() => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      requestId = crypto.randomUUID();
      state = emptyResaleSnapshot;
      publish({});
    }
  });
  async function run(write: boolean) {
    if (
      disposed ||
      state.busy ||
      !session.getSnapshot().session ||
      (write && (verifier || !state.page?.canRequest))
    )
      return;
    const page = state.page,
      version = ++generation;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    publish({ page: null, busy: true, error: null });
    try {
      const result = resaleInspectionReviewSchema.parse(
        write
          ? await session.requestResale(
              kathaId,
              resaleInspectionRequestSchema.parse({
                requestId,
                expectedConditionVersion: page!.inspection.version,
                expectedCustodyRevision: page!.custodyRevision,
                inspectionRequested: true,
              }),
              signal,
            )
          : await session.readResale(kathaId, signal, verifier),
      );
      if (disposed || signal.aborted || version !== generation) return;
      const auth = session.getSnapshot().session;
      if (
        result.kathaId !== kathaId ||
        result.cluster !== auth?.cluster ||
        (!verifier && result.ownerWallet !== auth?.walletAddress)
      )
        throw new Error("Inspection identity mismatch");
      if (result.requests.some((r) => r.id === requestId))
        requestId = crypto.randomUUID();
      publish({ page: result, busy: false });
    } catch {
      if (!disposed && !signal.aborted && version === generation)
        publish({
          page: null,
          busy: false,
          error:
            "Inspection coordination could not be confirmed. Refresh saved requests and current owner/custody before retrying.",
        });
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
    read: () => run(false),
    request: () => run(true),
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = emptyResaleSnapshot;
    },
  };
}
