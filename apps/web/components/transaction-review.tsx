"use client";
import { useSyncExternalStore } from "react";
import { useTransactionLifecycle } from "./wallet-provider";
import {
  idleTransactionSnapshot,
  type TransactionPhase,
  type TransactionSnapshot,
} from "../lib/transaction-lifecycle";
const noop = () => () => {};
const empty = () => idleTransactionSnapshot;
const labels: Record<TransactionPhase, string> = {
  idle: "No transaction to review",
  simulating: "Checking transaction simulation",
  review: "Review transaction before wallet approval",
  signing: "Waiting for wallet signature",
  recording: "Recording signed attempt",
  submitting: "Submitting transaction",
  confirming: "Checking finalized confirmation",
  unknown: "Confirmation unknown",
  expired: "Preparation expired",
  "not-completed": "Transaction not completed",
  failed: "Finalized transaction failed",
  "indexing-delay": "Transaction finalized; artwork indexing pending",
  indexed: "Transaction finalized and artwork history updated",
};
export function TransactionReview() {
  const controller = useTransactionLifecycle();
  const state = useSyncExternalStore(
    controller?.subscribe ?? noop,
    controller?.getSnapshot ?? empty,
    empty,
  );
  return (
    <TransactionReviewView
      state={state}
      onApprove={() => void controller?.approveAndSend()}
      onCheck={() => void controller?.checkConfirmation()}
      onCancel={() => controller?.cancel()}
    />
  );
}
export function TransactionReviewView({
  state,
  id = "transaction-review-title",
  title = "Transaction review",
  onApprove,
  onCheck,
  onCancel,
}: {
  state: TransactionSnapshot;
  id?: string;
  title?: string;
  onApprove: () => void;
  onCheck: () => void;
  onCancel: () => void;
}) {
  if (state.phase === "idle") return null;
  const operation = state.operation;
  return (
    <section aria-labelledby={id} className="mt-6 border-t border-line pt-4">
      <h3 id={id} className="text-xl">
        {title}
      </h3>
      <p role="status" className="mt-3">
        {state.operation?.kind === "CREATE_LISTING" && state.phase === "indexed"
          ? "Transaction finalized and active listing observed"
          : labels[state.phase]}
      </p>
      {operation && (
        <>
          <p className="mt-3 break-words">
            {operation.kind.replaceAll("_", " ")} · {operation.kathaId}
          </p>
          <p className="mt-2">
            {operation.cluster === "devnet" ? "Devnet" : "Localnet"} test environment ·
            Transaction v{operation.transactionVersion}
          </p>
          <p className="mt-2 break-all">
            Fee payer and authority: {operation.feePayer}
          </p>
          <p className="mt-2">
            Estimated network fee: {state.feeLamports ?? "pending"} lamports. Account
            rent may also apply. No token payment is included in this operation.
          </p>
          <p className="mt-2">
            Simulation checks execution but does not guarantee success.
          </p>
          <details className="mt-3">
            <summary>Review affected accounts and message commitment</summary>
            <p className="mt-2 break-all text-sm">Program: {state.program}</p>
            <p className="mt-2 break-all font-mono text-sm">{operation.messageHash}</p>
            <ul className="mt-2 text-sm">
              {state.accounts.map((account, index) => (
                <li key={`${index}-${account.address}`} className="break-all">
                  {account.address} · {account.role & 1 ? "writable" : "read only"}
                  {account.role & 2 ? " · signer" : ""}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {state.signature && (
        <p className="mt-3 break-all font-mono text-sm">Signature: {state.signature}</p>
      )}
      {state.error && (
        <p role="alert" className="mt-3">
          {state.error}
        </p>
      )}
      {state.phase === "review" && (
        <button type="button" className="button-primary mt-4" onClick={onApprove}>
          Approve in wallet and submit
        </button>
      )}
      {["unknown", "indexing-delay", "expired"].includes(state.phase) &&
        state.signature && (
          <button type="button" className="text-link mt-4" onClick={onCheck}>
            Check this transaction again
          </button>
        )}
      {!state.signature && (
        <button type="button" className="text-link mt-4 ml-4" onClick={onCancel}>
          Cancel transaction review
        </button>
      )}
    </section>
  );
}
