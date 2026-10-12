import {
  collectorDeliveryReviewSchema,
  fulfillmentCreateRequestSchema,
  fulfillmentReceiptRequestSchema,
  fulfillmentCancellationRequestSchema,
  type CollectorDeliveryReview,
  type FulfillmentCreateRequest,
} from "@katha/shared";
import type { WalletSessionController } from "./wallet-session.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";
export const emptyDeliverySnapshot = {
  page: null as CollectorDeliveryReview | null,
  busy: false,
  error: null as string | null,
  reloadRequired: false,
  requestId: null as string | null,
};
// The API only accepts a return while the owner holds the work; it rechecks the
// custody subject and rejects a second open request.
export function canReturn(page: CollectorDeliveryReview) {
  return (
    page.custodyState === "COLLECTOR_HELD" &&
    !page.requests.some(
      (row) =>
        row.kind === "RETURN_TO_KATHA" &&
        ["REQUESTED", "APPROVED", "DISPATCHED"].includes(row.status),
    )
  );
}
export function canCancel(status: string) {
  return status === "REQUESTED" || status === "APPROVED";
}
export function createCollectorDelivery(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "readDelivery"
    | "createDelivery"
    | "reportDeliveryReceipt"
    | "cancelDelivery"
  >,
  kathaId: string,
) {
  let state = emptyDeliverySnapshot,
    generation = 0,
    disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () =>
    session.getSnapshot().status === "signed-in"
      ? JSON.stringify(session.getSnapshot().session)
      : null;
  let current = identity();
  if (current) state = { ...state, requestId: crypto.randomUUID() };
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
      state = {
        ...emptyDeliverySnapshot,
        requestId: next ? crypto.randomUUID() : null,
      };
      publish({});
    }
  });
  async function run(
    write: boolean,
    action: (signal: AbortSignal) => Promise<CollectorDeliveryReview>,
  ) {
    if (disposed || !current || state.busy || (write && state.reloadRequired)) return;
    const version = ++generation;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    publish({ busy: true, error: null, ...(!write ? { page: null } : {}) });
    try {
      const page = collectorDeliveryReviewSchema.parse(await action(signal));
      if (disposed || signal.aborted || version !== generation) return;
      const auth = session.getSnapshot().session;
      if (
        page.kathaId !== kathaId ||
        page.ownerWallet !== auth?.walletAddress ||
        page.cluster !== auth?.cluster
      )
        throw new Error("Delivery identity mismatch");
      publish({
        page,
        busy: false,
        reloadRequired: false,
        requestId: page.requests.some((row) => row.id === state.requestId)
          ? crypto.randomUUID()
          : state.requestId,
      });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      publish({
        page: null,
        busy: false,
        reloadRequired: write,
        error:
          code === "FORBIDDEN" || code === "UNAUTHENTICATED"
            ? "A signed-in current Core owner is required to view delivery requests."
            : code === "CONFLICT"
              ? "The owner, custody or delivery request changed. Refresh saved state before continuing."
              : "Delivery coordination could not be confirmed. Refresh saved state before retrying; keep the same request ID if its outcome is uncertain.",
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
    read(offset = state.page?.pagination.offset ?? 0) {
      return run(false, (signal) =>
        session.readDelivery(kathaId, { limit: 20, offset }, signal),
      );
    },
    create(input: FulfillmentCreateRequest) {
      const page = state.page;
      if (!page || !(input.kind === "DELIVERY" ? page.canRequest : canReturn(page)))
        return Promise.resolve();
      return run(true, async (signal) => {
        const data = fulfillmentCreateRequestSchema.parse(input);
        if (data.kind !== input.kind || data.requestId !== state.requestId)
          throw new Error("Unsupported request");
        const result = await session.createDelivery(kathaId, data, signal);
        if (result.id !== data.requestId || result.kathaId !== kathaId)
          throw new Error("Request mismatch");
        return session.readDelivery(kathaId, { limit: 20, offset: 0 }, signal);
      });
    },
    report(id: string, confirmed: boolean) {
      const row = state.page?.requests.find((row) => row.id === id);
      if (
        !row ||
        row.kind !== "DELIVERY" ||
        row.status !== "DISPATCHED" ||
        row.ownerReportedReceivedAt ||
        !confirmed
      )
        return Promise.resolve();
      return run(true, async (signal) => {
        const input = fulfillmentReceiptRequestSchema.parse({
          expectedUpdatedAt: row.updatedAt,
          receiptConfirmed: confirmed,
        });
        const result = await session.reportDeliveryReceipt(id, input, signal);
        if (result.kathaId !== kathaId || result.id !== id)
          throw new Error("Receipt mismatch");
        return session.readDelivery(kathaId, { limit: 20, offset: 0 }, signal);
      });
    },
    // The requester can withdraw a request until Katha dispatches it.
    cancel(id: string, confirmed: boolean) {
      const row = state.page?.requests.find((row) => row.id === id);
      if (!row || !canCancel(row.status) || !confirmed) return Promise.resolve();
      return run(true, async (signal) => {
        const input = fulfillmentCancellationRequestSchema.parse({
          expectedUpdatedAt: row.updatedAt,
          cancellationConfirmed: confirmed,
        });
        const result = await session.cancelDelivery(id, input, signal);
        if (result.kathaId !== kathaId || result.id !== id)
          throw new Error("Cancellation mismatch");
        return session.readDelivery(kathaId, { limit: 20, offset: 0 }, signal);
      });
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubscribe();
      listeners.clear();
      state = emptyDeliverySnapshot;
    },
  };
}
export type CollectorDelivery = ReturnType<typeof createCollectorDelivery>;
