import { operationIdempotencyKey } from "./operation-retry.ts";
import {
  artworkMintRequestSchema,
  artworkPublicationRequestSchema,
  type ArtworkMintReview,
} from "@katha/shared";
import { validateRegistrationDocument } from "./artwork-registration.ts";
import { WalletSessionApiError } from "./wallet-session-api.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { TransactionLifecycle } from "./transaction-lifecycle.ts";
export const emptyMintSnapshot = {
  page: null as ArtworkMintReview | null,
  busy: false,
  error: null as string | null,
  reloadRequired: false,
};
export function createArtworkMintingWorkflow(
  session: Pick<
    WalletSessionController,
    | "getSnapshot"
    | "subscribe"
    | "permissions"
    | "readMinting"
    | "prepareMint"
    | "publishArtwork"
  >,
  connection: Pick<WalletConnection, "getSnapshot" | "subscribe" | "cluster">,
  transactions: Pick<TransactionLifecycle, "load" | "getSnapshot">,
  kathaId: string,
) {
  let state = emptyMintSnapshot,
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
      state = emptyMintSnapshot;
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
    action: (signal: AbortSignal) => Promise<ArtworkMintReview>,
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
        throw new Error("Mint review mismatch");
      await validateRegistrationDocument({ ...page, registration: page.mint });
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
      return run(false, (signal) => session.readMinting(kathaId, signal));
    },
    prepare(confirmed: boolean) {
      const page = state.page,
        chain = page?.chain,
        metadata = page?.metadata,
        report = page?.initialReport;
      if (
        !confirmed ||
        !page?.canMint ||
        !chain ||
        !metadata ||
        !report ||
        page.mint.unresolved ||
        chain.registrationAuthority !== session.getSnapshot().session?.walletAddress
      )
        return Promise.resolve();
      const version = generation + 1;
      return run(true, async (signal) => {
        await validateRegistrationDocument({ ...page, registration: page.mint });
        const input = artworkMintRequestSchema.parse({
          idempotencyKey:
            page.reservation?.idempotencyKey ??
            operationIdempotencyKey(
              `mint-${session.getSnapshot().session!.walletId}-${report.id}-${metadata.id}`,
              page.mint.receipt,
            ),
          expectedUpdatedAt: page.updatedAt,
          metadataVersionId: metadata.id,
          initialConditionReportId: report.id,
          expectedMetadataVersion: chain.metadataVersion,
          expectedConditionVersion: chain.conditionVersion,
          expectedCustodyRevision: chain.custodyRevision,
          supportedTransactionVersions: [
            ...(connection.getSnapshot().connected!.supportsV0 ? [0] : []),
            ...(connection.getSnapshot().connected!.supportsV1 ? [1] : []),
          ],
        });
        const operation = await session.prepareMint(kathaId, input, signal);
        if (disposed || signal.aborted || version !== generation)
          throw new Error("Session changed");
        await transactions.load(operation, {
          kind: "MINT_ARTWORK",
          kathaId,
          mint: {
            asset: chain.asset,
            collection: chain.collection,
            collectionAuthority: chain.collectionAuthority,
            initialConditionReportId: report.id,
            metadataVersion: chain.metadataVersion,
          },
        });
        return page;
      });
    },
    publish(confirmed: boolean) {
      const page = state.page;
      if (
        !confirmed ||
        !page?.canPublish ||
        !page.chain?.minted ||
        page.mint.unresolved ||
        page.published
      )
        return Promise.resolve();
      return run(true, (signal) =>
        session.publishArtwork(
          kathaId,
          artworkPublicationRequestSchema.parse({
            expectedUpdatedAt: page.updatedAt,
            publicationConfirmed: true,
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
      state = emptyMintSnapshot;
    },
  };
}
export type ArtworkMintingWorkflow = ReturnType<typeof createArtworkMintingWorkflow>;
