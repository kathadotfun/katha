import type { WalletOperation } from "./wallet-operation.ts";
import type { ArtworkProvenanceResponse, RegistrationIdentity } from "@katha/shared";
import {
  type ConditionTransactionReview,
  type CustodyTransactionReview,
  type MintTransactionReview,
  type MetadataTransactionReview,
  inspectPreparedTransaction,
  validateSignedTransaction,
} from "./prepared-transaction.ts";
import type { WalletConnection } from "./wallet-connection.ts";
import type { WalletSessionController } from "./wallet-session.ts";
import type { TransactionRpc } from "./transaction-rpc.ts";

export type TransactionPhase =
  | "idle"
  | "simulating"
  | "review"
  | "signing"
  | "recording"
  | "submitting"
  | "confirming"
  | "unknown"
  | "expired"
  | "not-completed"
  | "failed"
  | "indexing-delay"
  | "indexed";
export type TransactionSnapshot = Readonly<{
  phase: TransactionPhase;
  operation: WalletOperation | null;
  accounts: readonly { address: string; role: number }[];
  feeLamports: string | null;
  program: string | null;
  signature: string | null;
  purchaseOwnerConfirmed: boolean;
  error: string | null;
}>;
export const idleTransactionSnapshot: TransactionSnapshot = {
  phase: "idle",
  operation: null,
  accounts: [],
  feeLamports: null,
  program: null,
  signature: null,
  purchaseOwnerConfirmed: false,
  error: null,
};
function failedMessage(failureCode: string | null) {
  return failureCode === "BLOCKHASH_EXPIRED"
    ? "This attempt expired without reaching Solana. Nothing changed; you can prepare a fresh transaction."
    : "The finalized transaction failed. It did not complete this operation.";
}
export function createTransactionLifecycle(
  connection: WalletConnection,
  session: Pick<WalletSessionController, "getSnapshot" | "subscribe" | "reconcile">,
  rpc: TransactionRpc,
  provenance: (
    kathaId: string,
    signal: AbortSignal,
  ) => Promise<ArtworkProvenanceResponse>,
  indexed?: (
    operation: WalletOperation,
    signature: string,
    signal: AbortSignal,
  ) => Promise<boolean>,
  purchaseOwner?: (
    operation: Extract<WalletOperation, { kind: "PURCHASE_ARTWORK" }>,
    slot: string,
    signal: AbortSignal,
  ) => Promise<boolean>,
) {
  let state = idleTransactionSnapshot;
  let wire: string | null = null;
  let review: Parameters<typeof inspectPreparedTransaction>[1] | null = null;
  let finalized = false;
  let generation = 0;
  let disposed = false;
  let active = false;
  let abort = new AbortController();
  const listeners = new Set<() => void>();
  const identity = () => {
    const auth = session.getSnapshot().session;
    const connected = connection.getSnapshot().connected;
    return auth && connected
      ? `${auth.walletId}:${connected.walletId}:${connected.address}`
      : null;
  };
  let owner = identity();
  const publish = (patch: Partial<TransactionSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  function clear() {
    generation++;
    abort.abort();
    abort = new AbortController();
    active = false;
    wire = null;
    review = null;
    finalized = false;
    state = idleTransactionSnapshot;
    publish({});
  }
  const changed = () => {
    const next = identity();
    if (next !== owner) {
      owner = next;
      clear();
    }
  };
  const unsubscribeWallet = connection.subscribe(changed),
    unsubscribeSession = session.subscribe(changed);
  const signal = () => AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]);
  function assertIdentity(operation: WalletOperation) {
    const auth = session.getSnapshot().session,
      wallet = connection.getSnapshot();
    if (
      disposed ||
      !owner ||
      !auth ||
      wallet.status !== "connected" ||
      auth?.walletAddress !== operation.feePayer ||
      wallet.connected?.address !== operation.feePayer ||
      auth.cluster !== operation.cluster ||
      Date.parse(auth.expiresAt) <= Date.now() ||
      connection.cluster !== operation.cluster
    )
      throw new Error("Session changed.");
    if (
      !(operation.transactionVersion === 0
        ? wallet.connected?.supportsV0
        : wallet.connected?.supportsV1)
    )
      throw new Error("Unsupported transaction version.");
  }
  async function validLifetime(operation: WalletOperation, version: number) {
    const height = await rpc.height(signal());
    if (version !== generation || disposed) return false;
    if (typeof height !== "bigint" || height < 0n)
      throw new Error("Block height unavailable.");
    if (height >= BigInt(operation.lastValidBlockHeight)) {
      publish({
        phase: "expired",
        error:
          "This preparation expired. No new transaction will be submitted. Review its outcome before requesting a fresh preparation.",
      });
      return false;
    }
    return true;
  }
  async function observe(version: number) {
    if (!wire || !state.operation) return;
    publish({ phase: "confirming", error: null });
    const result = await session.reconcile(state.operation, wire, signal());
    if (version !== generation || disposed) return;
    const operation = state.operation;
    if (
      result.operationId !== operation.operationId ||
      result.preparationId !== operation.preparationId ||
      result.cluster !== operation.cluster ||
      result.kind !== operation.kind ||
      result.signature !== state.signature ||
      result.messageHash !== operation.messageHash
    )
      throw new Error("Receipt mismatch.");
    if (finalized && result.status !== "FINALIZED")
      throw new Error("Receipt regressed.");
    if (result.status === "FAILED") {
      publish({ phase: "failed", error: failedMessage(result.failureCode) });
      return;
    }
    if (result.status === "UNKNOWN") {
      publish({
        phase: "unknown",
        error:
          "Confirmation is unknown. Check the same signature again; do not submit a replacement.",
      });
      return;
    }
    finalized = true;
    publish({ phase: "indexing-delay", error: null });
    try {
      if (operation.kind === "PURCHASE_ARTWORK") {
        const confirmed =
          !!purchaseOwner && (await purchaseOwner(operation, result.slot!, signal()));
        if (version !== generation || disposed) return;
        publish({ purchaseOwnerConfirmed: confirmed });
        if (!confirmed) return;
      }
      if (indexed) {
        const seen = await indexed(operation, state.signature!, signal());
        if (version === generation && !disposed && seen) publish({ phase: "indexed" });
        return;
      }
      const history = await provenance(operation.kathaId, signal());
      if (version !== generation || disposed) return;
      if (
        history.kathaId === operation.kathaId &&
        history.chain.cluster.toLowerCase() === operation.cluster &&
        history.items.some((item) => item.transaction.signature === state.signature)
      )
        publish({ phase: "indexed" });
    } catch {
      /* Finalization remains true even when the indexer's public read is unavailable. */
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
    async load(
      input: unknown,
      expected: Pick<WalletOperation, "kind" | "kathaId"> & {
        purchase?: {
          quote: import("@katha/shared").PurchaseQuoteResponse;
          collection: string;
        };
        listing?: {
          price: string;
          expiresAt: string;
          expectedRevision: string;
          asset: string;
          collection: string;
        };
        registration?: RegistrationIdentity;
        verification?: { authorshipEvidenceHash: string };
        condition?: ConditionTransactionReview;
        custody?: CustodyTransactionReview;
        mint?: MintTransactionReview;
        metadata?: MetadataTransactionReview;
      },
    ) {
      if (
        active ||
        disposed ||
        (state.signature &&
          !["failed", "indexing-delay", "indexed"].includes(state.phase))
      )
        return;
      clear();
      const version = generation;
      active = true;
      publish({ phase: "simulating", error: null });
      try {
        const context = {
          ...expected,
          wallet: connection.getSnapshot().connected?.address ?? "",
          cluster: connection.cluster,
        };
        const prepared = await inspectPreparedTransaction(input, context);
        if (version !== generation || disposed) return;
        assertIdentity(prepared.operation);
        review = context;
        publish({
          operation: prepared.operation,
          accounts: prepared.accounts,
          program: prepared.program,
        });
        if (
          !(await validLifetime(prepared.operation, version)) ||
          version !== generation
        )
          return;
        const simulation = await rpc.simulate(prepared.operation, signal());
        if (version !== generation || disposed) return;
        if (
          !(await validLifetime(prepared.operation, version)) ||
          version !== generation
        )
          return;
        publish({ phase: "review", feeLamports: simulation.feeLamports });
      } catch {
        if (version === generation && !disposed)
          publish({
            phase: "not-completed",
            error:
              "Preparation or simulation could not complete. No signature was requested.",
          });
      } finally {
        if (version === generation) active = false;
      }
    },
    async approveAndSend() {
      if (active || state.phase !== "review" || !state.operation || disposed) return;
      const operation = state.operation,
        version = generation;
      active = true;
      try {
        assertIdentity(operation);
        if (!(await validLifetime(operation, version)) || version !== generation)
          return;
        const simulation = await rpc.simulate(operation, signal());
        if (version !== generation || disposed) return;
        if (simulation.feeLamports !== state.feeLamports) {
          publish({
            feeLamports: simulation.feeLamports,
            error: "The estimated network fee changed. Review it and approve again.",
          });
          return;
        }
        if (!(await validLifetime(operation, version))) return;
        assertIdentity(operation);
        publish({ phase: "signing", error: null });
        const signed = await connection.signPreparedTransaction(
          operation,
          abort.signal,
          review ?? undefined,
        );
        if (version !== generation || disposed) return;
        assertIdentity(operation);
        const signature = await validateSignedTransaction(signed, operation);
        if (version !== generation || disposed) return;
        wire = signed;
        publish({ signature, phase: "recording" });
        // Retain the signed attempt in the API before broadcast. It is still UNKNOWN.
        const retained = await session.reconcile(operation, signed, signal());
        if (version !== generation || disposed) return;
        if (
          retained.signature !== signature ||
          retained.messageHash !== operation.messageHash ||
          retained.operationId !== operation.operationId ||
          retained.preparationId !== operation.preparationId ||
          retained.kind !== operation.kind ||
          retained.cluster !== operation.cluster
        )
          throw new Error("Receipt mismatch.");
        if (retained.status === "FAILED") {
          publish({ phase: "failed", error: failedMessage(retained.failureCode) });
          return;
        }
        if (retained.status === "FINALIZED") {
          finalized = true;
          publish({ phase: "indexing-delay" });
          await observe(version);
          return;
        }
        assertIdentity(operation);
        if (!(await validLifetime(operation, version)) || version !== generation)
          return;
        publish({ phase: "submitting" });
        await rpc.submit(signed, signal());
        if (version !== generation || disposed) return;
        await observe(version);
      } catch {
        if (version === generation && !disposed)
          publish({
            phase: finalized
              ? "indexing-delay"
              : state.signature
                ? "unknown"
                : "not-completed",
            error: state.signature
              ? "Submission or confirmation is uncertain. Check this signature; do not resubmit."
              : "Wallet approval or preflight was not completed. No transaction was submitted.",
          });
      } finally {
        if (version === generation) active = false;
      }
    },
    async checkConfirmation() {
      if (
        active ||
        !wire ||
        disposed ||
        !["unknown", "indexing-delay", "expired"].includes(state.phase)
      )
        return;
      active = true;
      const version = generation;
      try {
        assertIdentity(state.operation!);
        await observe(version);
      } catch {
        if (version === generation && !disposed)
          publish({
            phase: finalized ? "indexing-delay" : "unknown",
            error:
              "The check could not complete. Keep the same signature; do not resubmit.",
          });
      } finally {
        if (version === generation) active = false;
      }
    },
    cancel() {
      if (!state.signature && !disposed) clear();
    },
    dispose() {
      disposed = true;
      unsubscribeWallet();
      unsubscribeSession();
      clear();
      listeners.clear();
    },
  };
}
export type TransactionLifecycle = ReturnType<typeof createTransactionLifecycle>;
