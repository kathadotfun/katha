import type { ArtworkVerificationReview } from "@katha/shared";
import { validateRegistrationDocument } from "./artwork-registration.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
export type VerificationSnapshot = Readonly<{
  page: ArtworkVerificationReview | null;
  busy: boolean;
  error: string | null;
  reloadRequired: boolean;
}>;
export const emptyVerificationSnapshot: VerificationSnapshot = {
  page: null,
  busy: false,
  error: null,
  reloadRequired: false,
};
export function createArtworkVerificationWorkflow(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readVerification"
    | "prepareVerification"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  kathaId: string,
) {
  let state = emptyVerificationSnapshot;
  let generation = 0,
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
      ? `${auth.walletId}:${wallet.walletId}:${wallet.address}:${auth.cluster}:${auth.expiresAt}`
      : null;
  };
  let current = identity();
  const publish = (patch: Partial<VerificationSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const changed = () => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      state = emptyVerificationSnapshot;
      publish({});
    }
  };
  const unsubSession = session.subscribe(changed),
    unsubWallet = connection.subscribe(changed);
  async function run(
    write: boolean,
    action: (signal: AbortSignal) => Promise<ArtworkVerificationReview>,
  ) {
    if (disposed || !current || state.busy || (write && state.reloadRequired)) return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({ busy: true, error: null, ...(write ? {} : { page: null }) });
    try {
      const roles = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!roles.verifier) throw new WalletSessionApiError("FORBIDDEN");
      const page = await action(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (page.kathaId !== kathaId || page.cluster !== connection.cluster)
        throw new Error("Review mismatch.");
      await validateRegistrationDocument(page);
      if (disposed || signal.aborted || version !== generation) return;
      publish({ page, busy: false, reloadRequired: false });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      publish({
        busy: false,
        reloadRequired: write,
        ...(code === "FORBIDDEN" || code === "UNAUTHENTICATED" ? { page: null } : {}),
        error:
          code === "FORBIDDEN" || code === "UNAUTHENTICATED"
            ? "A verifier session and the configured verification authority are required."
            : code === "CONFLICT"
              ? "The artwork, metadata or authority changed, or verification is already pending. Reload saved state before continuing."
              : "This request could not be confirmed. Reload saved state; check any retained signature before preparing a replacement.",
      });
    }
  }
  const canPrepare = () => {
    const page = state.page,
      flow = transactions.getSnapshot();
    return (
      page &&
      page.artistVerified &&
      page.identity &&
      !page.published &&
      page.registration.finalized &&
      !page.registration.unresolved &&
      !page.verification.finalized &&
      !page.verification.unresolved &&
      ![
        "simulating",
        "review",
        "signing",
        "recording",
        "submitting",
        "confirming",
        "unknown",
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
    read: () => run(false, (signal) => session.readVerification(kathaId, signal)),
    prepare(confirmed: boolean, reviewedEvidenceHash: string) {
      if (
        !confirmed ||
        !canPrepare() ||
        !state.page?.metadata ||
        reviewedEvidenceHash !== state.page.identity?.authorshipEvidenceHash
      )
        return Promise.resolve();
      const page = state.page!;
      const version = generation + 1;
      return run(true, async (signal) => {
        await validateRegistrationDocument(page);
        const wallet = connection.getSnapshot().connected!;
        const supportedTransactionVersions: (0 | 1)[] = [
          ...(wallet.supportsV0 ? [0 as const] : []),
          ...(wallet.supportsV1 ? [1 as const] : []),
        ];
        if (
          !supportedTransactionVersions.length ||
          (connection.cluster === "localnet" && !wallet.supportsV0)
        )
          throw new WalletSessionApiError("INVALID_REQUEST");
        const prepared = await session.prepareVerification(
          kathaId,
          {
            authenticityConfirmed: true,
            reviewedEvidenceHash,
            idempotencyKey: `verify-${session.getSnapshot().session!.walletId}-${page.metadata!.id}`,
            expectedUpdatedAt: page.updatedAt,
            metadataVersionId: page.metadata!.id,
            supportedTransactionVersions,
          },
          signal,
        );
        if (disposed || signal.aborted || version !== generation)
          throw new Error("Session changed.");
        await transactions.load(prepared, {
          kind: "VERIFY_ARTWORK",
          kathaId,
          verification: { authorshipEvidenceHash: reviewedEvidenceHash },
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
      state = emptyVerificationSnapshot;
    },
  };
}
export type ArtworkVerificationWorkflow = ReturnType<
  typeof createArtworkVerificationWorkflow
>;
