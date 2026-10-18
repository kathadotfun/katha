import {
  custodyPreparationRequestSchema,
  fulfillmentUpdateRequestSchema,
  type CustodyAdministrationReview,
  type CustodyPreparationRequest,
  type FulfillmentUpdateRequest,
} from "@katha/shared";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
export const emptyCustodySnapshot = {
  page: null as CustodyAdministrationReview | null,
  busy: false,
  error: null as string | null,
  reloadRequired: false,
};
export function createCustodyAdministrationWorkflow(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readCustody"
    | "updateFulfillment"
    | "prepareCustody"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  kathaId: string,
) {
  let state = emptyCustodySnapshot,
    generation = 0,
    disposed = false;
  let abort: AbortController | null = null;
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot().session,
      wallet = connection.getSnapshot().connected;
    return auth &&
      wallet &&
      auth.walletAddress === wallet.address &&
      auth.cluster === connection.cluster
      ? `${auth.walletId}:${wallet.walletId}:${wallet.address}:${auth.expiresAt}`
      : null;
  };
  let current = identity();
  const publish = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const changed = () => {
    const next = identity();
    if (current !== next) {
      current = next;
      generation++;
      abort?.abort();
      state = emptyCustodySnapshot;
      publish({});
    }
  };
  const unsubSession = session.subscribe(changed),
    unsubWallet = connection.subscribe(changed);
  async function run(
    write: boolean,
    action: (signal: AbortSignal) => Promise<CustodyAdministrationReview>,
  ) {
    if (disposed || !current || state.busy || (write && state.reloadRequired)) return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({ busy: true, error: null, ...(!write ? { page: null } : {}) });
    try {
      const roles = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!roles.admin) throw new WalletSessionApiError("FORBIDDEN");
      const page = await action(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (page.kathaId !== kathaId || page.cluster !== connection.cluster)
        throw new Error("Custody review mismatch");
      publish({ page, busy: false, reloadRequired: false });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      publish({
        busy: false,
        reloadRequired: write,
        ...(["FORBIDDEN", "UNAUTHENTICATED"].includes(code) ? { page: null } : {}),
        error:
          code === "FORBIDDEN" || code === "UNAUTHENTICATED"
            ? "A current administrator session is required to view private fulfillment requests."
            : code === "CONFLICT"
              ? "The request, artwork, owner or custody changed. Reload saved state before continuing."
              : "This action could not be confirmed. Reload saved state and check any retained signature before preparing a replacement.",
      });
    }
  }
  const free = () => {
    const flow = transactions.getSnapshot();
    return (
      [
        "idle",
        "not-completed",
        "failed",
        "expired",
        "indexing-delay",
        "indexed",
      ].includes(flow.phase) &&
      (!flow.signature || ["failed", "indexing-delay", "indexed"].includes(flow.phase))
    );
  };
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
        session.readCustody(kathaId, { limit: 20, offset }, signal),
      );
    },
    update(id: string, input: FulfillmentUpdateRequest) {
      const page = state.page,
        row = page?.requests.find((item) => item.request.id === id);
      if (!page || !row || !free()) return Promise.resolve();
      return run(true, async (signal) => {
        const data = fulfillmentUpdateRequestSchema.parse(input);
        if (
          data.expectedUpdatedAt !== row.request.updatedAt ||
          !row.allowedStatuses.includes(data.status)
        )
          throw new WalletSessionApiError("CONFLICT");
        const result = await session.updateFulfillment(id, data, signal);
        if (result.kathaId !== kathaId) throw new Error("Fulfillment artwork mismatch");
        return session.readCustody(kathaId, page.pagination, signal);
      });
    },
    prepare(input: CustodyPreparationRequest) {
      const page = state.page;
      if (!page || !free() || page.custody.unresolved || !page.canAttest)
        return Promise.resolve();
      const version = generation + 1;
      return run(true, async (signal) => {
        const data = custodyPreparationRequestSchema.parse(input);
        const allowed = data.fulfillmentId
          ? (page.requests.find((row) => row.request.id === data.fulfillmentId)
              ?.transitions ?? [])
          : page.transitions;
        if (
          data.expectedUpdatedAt !== page.updatedAt ||
          data.expectedCustodyRevision !== page.chain.revision ||
          !allowed.some((t) => JSON.stringify(t) === JSON.stringify(data.transition)) ||
          (data.transition.to === "COLLECTOR_HELD" &&
            page.chain.ownerWallet !== null &&
            data.collectorWallet !== page.chain.ownerWallet)
        )
          throw new WalletSessionApiError("CONFLICT");
        const operation = await session.prepareCustody(kathaId, data, signal);
        if (disposed || signal.aborted || version !== generation)
          throw new Error("Session changed");
        await transactions.load(operation, {
          kind: "UPDATE_CUSTODY",
          kathaId,
          custody: {
            transition: data.transition,
            expectedCustodyRevision: data.expectedCustodyRevision,
            collectorWallet: data.collectorWallet,
          },
        });
        return page;
      });
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      unsubSession();
      unsubWallet();
      listeners.clear();
      state = emptyCustodySnapshot;
    },
  };
}
export type CustodyAdministrationWorkflow = ReturnType<
  typeof createCustodyAdministrationWorkflow
>;
