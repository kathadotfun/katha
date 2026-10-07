import {
  metadataRevisionRequestSchema,
  metadataRevisionDocumentRequestSchema,
  metadataDocumentSchema,
  canonicalDocumentBytes,
  type MetadataRevisionDocumentRequest,
  type MetadataRevisionReview,
} from "@katha/shared";
import { validateRegistrationDocument } from "./artwork-registration.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
export const emptyMetadataSnapshot = {
  page: null as MetadataRevisionReview | null,
  busy: false,
  error: null as string | null,
  reloadRequired: false,
};
export function createMetadataRevisionWorkflow(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readMetadataRevisions"
    | "prepareMetadataRevision"
    | "saveMetadataRevisionDocument"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  kathaId: string,
) {
  let state = emptyMetadataSnapshot,
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
  const emit = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const changed = () => {
    const next = identity();
    if (current !== next) {
      current = next;
      generation++;
      abort?.abort();
      state = emptyMetadataSnapshot;
      emit({});
    }
  };
  const offSession = session.subscribe(changed),
    offWallet = connection.subscribe(changed);
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
  async function run(
    write: boolean,
    action: (signal: AbortSignal) => Promise<MetadataRevisionReview>,
  ) {
    if (
      disposed ||
      !current ||
      state.busy ||
      (write && (state.reloadRequired || !free()))
    )
      return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    emit({ busy: true, error: null, ...(!write ? { page: null } : {}) });
    try {
      const roles = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!roles.admin) throw new WalletSessionApiError("FORBIDDEN");
      const page = await action(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (page.kathaId !== kathaId || page.cluster !== connection.cluster)
        throw new Error("Metadata review mismatch");
      await validateRegistrationDocument({ ...page, registration: page.revision });
      if (disposed || signal.aborted || version !== generation) return;
      if (page.current)
        await validateRegistrationDocument({
          ...page,
          metadata: page.current,
          registration: page.revision,
        });
      if (
        (page.canSave || page.canSubmit) &&
        (page.chain.version === 0
          ? page.current !== null
          : !page.current ||
            page.current.documentHash !== page.chain.documentHash ||
            page.current.uri !== page.chain.uri)
      )
        throw new Error("Current commitment mismatch");
      if (page.current && page.metadata) {
        const before = metadataDocumentSchema.parse(
          JSON.parse(page.current.canonicalDocument),
        );
        const after = metadataDocumentSchema.parse(
          JSON.parse(page.metadata.canonicalDocument),
        );
        if (
          new TextDecoder().decode(
            canonicalDocumentBytes({ ...before, publicContent: {} }),
          ) !==
          new TextDecoder().decode(
            canonicalDocumentBytes({ ...after, publicContent: {} }),
          )
        )
          throw new Error("Immutable document fields changed");
      }
      if (disposed || signal.aborted || version !== generation) return;
      emit({ page, busy: false, reloadRequired: false });
    } catch (error) {
      if (disposed || signal.aborted || version !== generation) return;
      const code = error instanceof WalletSessionApiError ? error.code : "UNAVAILABLE";
      emit({
        busy: false,
        reloadRequired: write,
        ...(["FORBIDDEN", "UNAUTHENTICATED"].includes(code) ? { page: null } : {}),
        error:
          code === "FORBIDDEN" || code === "UNAUTHENTICATED"
            ? "A current administrator session is required."
            : code === "CONFLICT"
              ? "The artwork or chain state changed. Reload saved state before continuing."
              : "This action could not be confirmed. Reload saved state and check any retained signature before trying again.",
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
    read() {
      return run(false, (signal) => session.readMetadataRevisions(kathaId, signal));
    },

    prepare(confirmed: boolean) {
      const page = state.page,
        chain = page?.chain,
        metadata = page?.metadata;
      if (
        !confirmed ||
        !page?.canSubmit ||
        !metadata ||
        !chain ||
        page.revision.unresolved ||
        chain.registrationAuthority !== session.getSnapshot().session?.walletAddress
      )
        return Promise.resolve();
      const version = generation + 1;
      return run(true, async (signal) => {
        await validateRegistrationDocument({ ...page, registration: page.revision });
        const input = metadataRevisionRequestSchema.parse({
          idempotencyKey: `metadata-${session.getSnapshot().session!.walletId}-${metadata.id}`,
          expectedUpdatedAt: page.updatedAt,
          metadataVersionId: metadata.id,
          expectedMetadataVersion: chain.version,
          expectedMetadataHash: chain.documentHash,
          supportedTransactionVersions: [
            ...(connection.getSnapshot().connected!.supportsV0 ? [0] : []),
            ...(connection.getSnapshot().connected!.supportsV1 ? [1] : []),
          ],
        });
        const operation = await session.prepareMetadataRevision(kathaId, input, signal);
        if (disposed || signal.aborted || version !== generation)
          throw new Error("Session changed");
        await transactions.load(operation, {
          kind: "REVISE_METADATA",
          kathaId,
          metadata: { metadata, chain },
        });
        return page;
      });
    },
    save(
      publicContent: MetadataRevisionDocumentRequest["publicContent"],
      confirmed: boolean,
    ) {
      const page = state.page;
      if (!confirmed || !page?.canSave || !page.metadata || page.revision.unresolved)
        return Promise.resolve();
      const original = metadataDocumentSchema.parse(
        JSON.parse(page.metadata.canonicalDocument),
      );
      if (JSON.stringify(original.publicContent) === JSON.stringify(publicContent))
        return Promise.resolve();
      return run(true, (signal) =>
        session.saveMetadataRevisionDocument(
          kathaId,
          metadataRevisionDocumentRequestSchema.parse({
            expectedUpdatedAt: page.updatedAt,
            metadataVersionId: page.metadata!.id,
            publicContent,
            publicApprovalConfirmed: true,
          }),
          signal,
        ),
      );
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      offSession();
      offWallet();
      listeners.clear();
      state = emptyMetadataSnapshot;
    },
  };
}
export type MetadataRevisionWorkflow = ReturnType<
  typeof createMetadataRevisionWorkflow
>;
