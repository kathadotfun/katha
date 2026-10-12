import { operationIdempotencyKey } from "./operation-retry.ts";
import {
  conditionReportDocumentSchema,
  conditionPreparationRequestSchema,
  canonicalDocumentBytes,
  sha256Hex,
  type ConditionInspectionReview,
  type ConditionPreparationRequest,
} from "@katha/shared";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
export async function validateConditionDocument(page: ConditionInspectionReview) {
  if (!page.report) return null;
  const document = conditionReportDocumentSchema.parse(
    JSON.parse(page.report.canonicalDocument),
  );
  const bytes = canonicalDocumentBytes(document);
  if (
    new TextDecoder().decode(bytes) !== page.report.canonicalDocument ||
    (await sha256Hex(bytes)) !== page.report.documentHash ||
    document.reportId !== page.report.id ||
    document.kathaId !== page.kathaId
  )
    throw new Error("Condition document integrity mismatch");
  return document;
}
export const emptyConditionSnapshot = {
  page: null as ConditionInspectionReview | null,
  busy: false,
  error: null as string | null,
  reloadRequired: false,
};
export function createConditionInspectionWorkflow(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readCondition"
    | "prepareConditionDocument"
    | "prepareConditionAttestation"
    | "uploadConditionEvidence"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  kathaId: string,
) {
  let state = emptyConditionSnapshot,
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
    if (next !== current) {
      current = next;
      generation++;
      abort?.abort();
      state = emptyConditionSnapshot;
      publish({});
    }
  };
  const unsubSession = session.subscribe(changed),
    unsubWallet = connection.subscribe(changed);
  async function run(
    write: boolean,
    action: (signal: AbortSignal) => Promise<ConditionInspectionReview>,
  ) {
    if (disposed || !current || state.busy || (write && state.reloadRequired)) return;
    const version = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    publish({ busy: true, error: null, ...(!write ? { page: null } : {}) });
    try {
      const roles = await session.permissions(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (!roles.verifier) throw new WalletSessionApiError("FORBIDDEN");
      const page = await action(signal);
      if (disposed || signal.aborted || version !== generation) return;
      if (page.kathaId !== kathaId || page.cluster !== connection.cluster)
        throw new Error("Inspection review mismatch");
      await validateConditionDocument(page);
      if (disposed || signal.aborted || version !== generation) return;
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
            ? "A verifier session and current Registry verification authority are required."
            : code === "CONFLICT"
              ? "The report, artwork, owner, custody or condition version changed. Reload saved inspection state before continuing."
              : "This request could not be confirmed. Reload saved state and check any retained signature before preparing a replacement.",
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
  const canWrite = () =>
    Boolean(
      state.page &&
      !state.page.unresolved &&
      !state.page.attestation.unresolved &&
      free(),
    );
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    read: () => run(false, (signal) => session.readCondition(kathaId, signal)),
    upload(file: File) {
      if (!canWrite()) return Promise.resolve();
      const page = state.page!;
      return run(true, async (signal) => {
        const hash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
        const saved = await session.uploadConditionEvidence(
          kathaId,
          page.updatedAt,
          file,
          signal,
        );
        if (!saved.media.some((item) => item.contentHash === hash))
          throw new Error("Evidence mismatch");
        return saved;
      });
    },
    prepareDocument(input: ConditionPreparationRequest, confirmed: boolean) {
      if (!confirmed || !canWrite()) return Promise.resolve();
      const page = state.page!;
      return run(true, async (signal) => {
        const data = conditionPreparationRequestSchema.parse(input);
        if (
          data.expectedUpdatedAt !== page.updatedAt ||
          !page.chain.allowedReasons.includes(data.reason) ||
          JSON.stringify(data.scope ?? null) !== JSON.stringify(page.chain.scope)
        )
          throw new WalletSessionApiError("CONFLICT");
        const { expectedUpdatedAt, mediaIds, ...fields } = data;
        if (expectedUpdatedAt !== page.updatedAt)
          throw new WalletSessionApiError("CONFLICT");
        const document = conditionReportDocumentSchema.parse({
          ...fields,
          kathaId,
          verifierWallet: session.getSnapshot().session!.walletAddress,
          mediaHashes: mediaIds.map((id) => {
            const item = page.media.find((row) => row.id === id);
            if (!item) throw new Error("Unknown evidence");
            return item.contentHash;
          }),
        });
        const expectedHash = await sha256Hex(canonicalDocumentBytes(document));
        const response = await session.prepareConditionDocument(kathaId, data, signal),
          saved = await session.readCondition(kathaId, signal);
        if (
          response.documentHash !== expectedHash ||
          saved.report?.id !== data.reportId ||
          saved.report.documentHash !== expectedHash ||
          saved.report.canonicalDocument !==
            new TextDecoder().decode(canonicalDocumentBytes(document))
        )
          throw new Error("Saved report mismatch");
        return saved;
      });
    },
    prepareAttestation(confirmed: boolean) {
      if (
        !confirmed ||
        !canWrite() ||
        !state.page?.report ||
        state.page.report.status !== "PREPARED" ||
        state.page.attestation.finalized
      )
        return Promise.resolve();
      const page = state.page!,
        version = generation + 1;
      return run(true, async (signal) => {
        const document = await validateConditionDocument(page);
        if (
          !document ||
          document.verifierWallet !== session.getSnapshot().session?.walletAddress ||
          JSON.stringify(document.scope ?? null) !== JSON.stringify(page.chain.scope) ||
          !page.chain.allowedReasons.includes(document.reason)
        )
          throw new WalletSessionApiError("CONFLICT");
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
        const operation = await session.prepareConditionAttestation(
          kathaId,
          {
            reportId: page.report!.id,
            expectedUpdatedAt: page.updatedAt,
            expectedConditionVersion: page.chain.version,
            idempotencyKey: operationIdempotencyKey(
              `condition-${session.getSnapshot().session!.walletId}-${page.report!.id}`,
              page.attestation.receipt,
            ),
            supportedTransactionVersions,
          },
          signal,
        );
        if (disposed || signal.aborted || version !== generation)
          throw new Error("Session changed");
        await transactions.load(operation, {
          kind: "RECORD_CONDITION",
          kathaId,
          condition: {
            document,
            reportHash: page.report!.documentHash,
            expectedVersion: page.chain.version,
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
      state = emptyConditionSnapshot;
    },
  };
}
export type ConditionInspectionWorkflow = ReturnType<
  typeof createConditionInspectionWorkflow
>;
