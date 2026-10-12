import { operationIdempotencyKey } from "./operation-retry.ts";
import {
  metadataDocumentSchema,
  canonicalDocumentBytes,
  sha256Hex,
  type ArtworkRegistrationReview,
} from "@katha/shared";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
export type RegistrationSnapshot = Readonly<{
  page: ArtworkRegistrationReview | null;
  busy: boolean;
  error: string | null;
  reloadRequired: boolean;
}>;
export const emptyRegistrationSnapshot: RegistrationSnapshot = {
  page: null,
  busy: false,
  error: null,
  reloadRequired: false,
};
export async function validateRegistrationDocument(page: ArtworkRegistrationReview) {
  if (!page.metadata) return;
  const document = metadataDocumentSchema.parse(
    JSON.parse(page.metadata.canonicalDocument),
  );
  const bytes = canonicalDocumentBytes(document);
  if (
    new TextDecoder().decode(bytes) !== page.metadata.canonicalDocument ||
    (await sha256Hex(bytes)) !== page.metadata.documentHash ||
    document.kathaId !== page.kathaId ||
    document.name !== page.title ||
    !page.identity ||
    document.artist.artistId !== page.identity.artistId ||
    (document.artist.creatorWallet ?? null) !== page.identity.creatorWallet ||
    document.category !== page.identity.category ||
    document.creationYear !== page.identity.creationYear
  )
    throw new Error("Metadata integrity mismatch.");
}
export function createArtworkRegistrationWorkflow(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readRegistration"
    | "prepareMetadata"
    | "prepareRegistration"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  kathaId: string,
) {
  let state = emptyRegistrationSnapshot;
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
  const publish = (patch: Partial<RegistrationSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const changed = () => {
    const next = identity();
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      state = emptyRegistrationSnapshot;
      publish({});
    }
  };
  const unsubSession = session.subscribe(changed),
    unsubWallet = connection.subscribe(changed);
  async function run(
    write: boolean,
    action: (signal: AbortSignal) => Promise<ArtworkRegistrationReview>,
  ) {
    if (disposed || !current || state.busy || (write && state.reloadRequired)) return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({ busy: true, error: null, ...(write ? {} : { page: null }) });
    try {
      const roles = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!roles.admin) throw new WalletSessionApiError("FORBIDDEN");
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
            ? "An administrator session and the configured registration authority are required."
            : code === "CONFLICT"
              ? "The artwork, metadata or authority changed, or registration is already pending. Reload saved state before continuing."
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
      !page.registration.finalized &&
      !page.registration.unresolved &&
      ![
        "simulating",
        "review",
        "signing",
        "recording",
        "submitting",
        "confirming",
        "unknown",
        "indexing-delay",
        "indexed",
      ].includes(flow.phase) &&
      (!flow.signature || flow.phase === "failed")
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
    read: () => run(false, (signal) => session.readRegistration(kathaId, signal)),
    prepareMetadata() {
      if (!canPrepare() || state.page?.metadata) return Promise.resolve();
      const page = state.page!;
      return run(true, async (signal) => {
        const document = await session.prepareMetadata(kathaId, page.updatedAt, signal);
        const saved = await session.readRegistration(kathaId, signal);
        if (
          saved.metadata?.id !== document.id ||
          saved.metadata.documentHash !== document.documentHash ||
          saved.metadata.uri !== document.uri
        )
          throw new Error("Document changed.");
        return saved;
      });
    },
    prepare(confirmed: boolean) {
      if (!confirmed || !canPrepare() || state.page?.metadata?.status !== "PREPARED")
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
        const prepared = await session.prepareRegistration(
          kathaId,
          {
            idempotencyKey: operationIdempotencyKey(
              `register-${session.getSnapshot().session!.walletId}-${page.metadata!.id}`,
              page.registration.receipt,
            ),
            expectedUpdatedAt: page.updatedAt,
            metadataVersionId: page.metadata!.id,
            supportedTransactionVersions,
          },
          signal,
        );
        if (disposed || signal.aborted || version !== generation)
          throw new Error("Session changed.");
        await transactions.load(prepared, {
          kind: "REGISTER_ARTWORK",
          kathaId,
          registration: page.identity!,
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
      state = emptyRegistrationSnapshot;
    },
  };
}
export type ArtworkRegistrationWorkflow = ReturnType<
  typeof createArtworkRegistrationWorkflow
>;
