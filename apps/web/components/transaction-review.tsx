"use client";
import { useSyncExternalStore } from "react";
import { useTransactionLifecycle } from "./wallet-provider";
import {
  idleTransactionSnapshot,
  type TransactionPhase,
  type TransactionSnapshot,
} from "../lib/transaction-lifecycle";
import { localDateTime, tokenAmount, unixSecondsIso } from "../lib/format";
import { Badge, type Tone } from "./ui/status";

const noop = () => () => {};
const empty = () => idleTransactionSnapshot;

// Screen-reader status keeps the precise lifecycle wording; the badge is a summary.
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
const badges: Record<TransactionPhase, [Tone, string]> = {
  idle: ["neu", "Not started"],
  simulating: ["info", "Simulating"],
  review: ["info", "Ready to approve"],
  signing: ["info", "Waiting for wallet"],
  recording: ["info", "Submitted"],
  submitting: ["info", "Submitted"],
  confirming: ["info", "Finalizing"],
  unknown: ["warn", "Outcome unknown"],
  expired: ["warn", "Expired"],
  "not-completed": ["err", "Not completed"],
  failed: ["err", "Failed on Solana"],
  "indexing-delay": ["warn", "Indexing delayed"],
  indexed: ["ok", "Complete"],
};

function statusLabel(state: TransactionSnapshot) {
  const kind = state.operation?.kind;
  if (kind === "CREATE_LISTING" && state.phase === "indexed")
    return "Transaction finalized and active listing observed";
  if (kind === "CANCEL_LISTING" && state.phase === "indexed")
    return "Transaction finalized and cancelled listing observed";
  if (kind === "PURCHASE_ARTWORK" && state.phase === "indexing-delay")
    return state.purchaseOwnerConfirmed
      ? "Purchase finalized; buyer Core ownership confirmed; artwork indexing pending"
      : "Purchase finalized; Core ownership and indexing checks pending";
  if (kind === "PURCHASE_ARTWORK" && state.phase === "indexed")
    return "Purchase finalized; buyer Core ownership confirmed and transfer history indexed";
  return labels[state.phase];
}

type Step = { title: string; detail: string; cls: string; mark: string; sr: string };

function steps(state: TransactionSnapshot): Step[] {
  const kind = state.operation?.kind;
  const purchase = kind === "PURCHASE_ARTWORK";
  const listing = kind === "CREATE_LISTING" || kind === "CANCEL_LISTING";
  const base = [
    ["Prepare transaction", "Katha builds the exact transaction for this operation."],
    [
      "Check it before you approve",
      "It's simulated first, so problems show up before you approve. A passing simulation doesn't guarantee success.",
    ],
    ["Approve in your wallet", "Your wallet shows the same accounts and amounts."],
    ["Submitted to Solana", "The signed transaction is sent to the network."],
    ["Finalized on Solana", "Solana has finalized it; it can't be reversed."],
    ...(purchase
      ? [["Ownership confirmed", "The artwork's asset is in your wallet."]]
      : []),
    purchase
      ? ["History indexed", "The sale appears in the artwork's public history."]
      : listing
        ? [
            kind === "CREATE_LISTING"
              ? "Listing visible on the record"
              : "Cancellation visible on the record",
            "Katha observes the finalized listing state.",
          ]
        : ["Indexed by Katha", "The change appears in the artwork's history."],
  ];
  const last = base.length - 1;
  const ownerStep = purchase ? 5 : -1;
  // `at` is the current step; earlier steps are done.
  const position: Record<TransactionPhase, number> = {
    idle: 0,
    simulating: 1,
    review: 2,
    signing: 2,
    recording: 3,
    submitting: 3,
    confirming: 4,
    unknown: 3,
    expired: state.signature ? 3 : 2,
    "not-completed": 2,
    failed: 4,
    "indexing-delay": purchase
      ? state.purchaseOwnerConfirmed
        ? last
        : ownerStep
      : last,
    indexed: base.length,
  };
  const at = position[state.phase];
  const errorAt =
    state.phase === "failed"
      ? 4
      : state.phase === "not-completed" ||
          (state.phase === "expired" && !state.signature)
        ? 2
        : undefined;
  const warnAt =
    state.phase === "unknown" || (state.phase === "expired" && state.signature)
      ? 3
      : state.phase === "indexing-delay"
        ? last
        : undefined;
  const override: Partial<Record<TransactionPhase, string>> = {
    review: "Review the prepared transaction below, then approve it in your wallet.",
    signing: "Waiting for your wallet. Approve or decline there.",
    recording: "Saving the signed attempt so it can be checked later.",
    confirming: "Waiting for Solana to finalize. This usually takes under a minute.",
    unknown:
      "We can't confirm whether this reached Solana. Its reference is saved below. Check its status before doing anything else; approving again could repeat it.",
    expired: state.signature
      ? "The preparation expired before confirmation was observed. Check its status before preparing again."
      : "The prepared transaction expired before it was approved. Nothing was sent. Prepare it again to get current terms.",
    "not-completed":
      "This wasn't completed. Nothing was sent, and you can prepare again.",
    failed: "Solana finalized this transaction as failed. Nothing changed.",
    "indexing-delay":
      "Indexing is taking longer than usual. The transaction is already finalized on Solana.",
  };
  return base.map(([title, detail], index) => {
    let step: Step = {
      title: title!,
      detail: detail!,
      cls: "",
      mark: String(index + 1),
      sr: "not started",
    };
    if (index < at) step = { ...step, cls: "d-done", mark: "✓", sr: "done" };
    if (index === at && state.phase !== "idle")
      step = { ...step, cls: "d-now", sr: "in progress" };
    if (index === errorAt) step = { ...step, cls: "d-err", mark: "!", sr: "failed" };
    if (index === warnAt)
      step = { ...step, cls: "d-warn", mark: "?", sr: "needs attention" };
    if (
      index === ownerStep &&
      purchase &&
      state.phase === "indexing-delay" &&
      !state.purchaseOwnerConfirmed
    )
      step = { ...step, detail: "Checking that the asset reached your wallet." };
    const focus = errorAt ?? warnAt ?? at;
    if (index === focus && override[state.phase])
      step = { ...step, detail: override[state.phase]! };
    return step;
  });
}

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
  title = "Transaction",
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
  const [tone, badge] = badges[state.phase];
  const explorer =
    state.signature && operation?.cluster === "devnet"
      ? `https://explorer.solana.com/tx/${state.signature}?cluster=devnet`
      : null;
  return (
    <section aria-labelledby={id} className="panel cut panel-lg">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <h3 id={id} className="h3">
          {title}
        </h3>
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <p role="status" className="sr-only">
        {statusLabel(state)}
      </p>
      <ol className="txs mt-4">
        {steps(state).map((step) => (
          <li key={step.title}>
            <span className={`dot cut-s ${step.cls}`} aria-hidden="true">
              {step.mark}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="m-0 font-semibold">
                {step.title}
                <span className="sr-only"> ({step.sr})</span>
              </p>
              <p className="p sm wrap-anywhere">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      {operation && (
        <div className="inset mt-4">
          <p className="serif m-0 mb-1.5 text-lg font-semibold text-madder">
            {state.phase === "review" ? "Prepared transaction" : "Transaction details"}
          </p>
          <dl className="m-0">
            <div className="kv">
              <dt>Operation</dt>
              <dd>
                {operation.kind.replaceAll("_", " ").toLowerCase()} ·{" "}
                {operation.kathaId}
              </dd>
            </div>
            {operation.kind === "PURCHASE_ARTWORK" && (
              <>
                <div className="kv">
                  <dt>You send</dt>
                  <dd>
                    {tokenAmount(operation.quote.price)} Katha test token (
                    {operation.quote.price} base units · six decimals · no monetary
                    value)
                  </dd>
                </div>
                <div className="kv">
                  <dt>Payment mint</dt>
                  <dd className="id">{operation.quote.payment.paymentMint}</dd>
                </div>
                <div className="kv">
                  <dt>Recipients</dt>
                  <dd>
                    <ul className="m-0 list-none p-0">
                      {operation.quote.distribution.recipients.map((recipient) => (
                        <li key={recipient.wallet} className="wrap-anywhere">
                          <span className="id">{recipient.wallet}</span> ·{" "}
                          {recipient.amount} base units
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div className="kv">
                  <dt>Listing revision</dt>
                  <dd>{operation.quote.revision}</dd>
                </div>
              </>
            )}
            {(operation.kind === "CREATE_LISTING" ||
              operation.kind === "CANCEL_LISTING") && (
              <>
                <div className="kv">
                  <dt>Price</dt>
                  <dd>
                    {tokenAmount(operation.price)} Katha test token ({operation.price}{" "}
                    base units)
                  </dd>
                </div>
                <div className="kv">
                  <dt>Listing ends</dt>
                  <dd>{localDateTime(unixSecondsIso(operation.expiresAt))}</dd>
                </div>
                {operation.kind === "CREATE_LISTING" && operation.fees && (
                  <div className="kv">
                    <dt>Sale fees</dt>
                    <dd>
                      {operation.fees.platformCommissionBps / 100}% Katha commission ·{" "}
                      {operation.fees.secondaryRoyaltyBps / 100}% artist resale royalty
                    </dd>
                  </div>
                )}
              </>
            )}
            <div className="kv">
              <dt>Network</dt>
              <dd>
                {operation.cluster === "devnet" ? "Solana Devnet" : "Localnet"} test
                environment · transaction v{operation.transactionVersion}
              </dd>
            </div>
            <div className="kv">
              <dt>Fee payer and authority</dt>
              <dd className="id">{operation.feePayer}</dd>
            </div>
            <div className="kv">
              <dt>Network fee</dt>
              <dd>
                Estimated {state.feeLamports ?? "pending"} lamports; account rent may
                also apply.{" "}
                {operation.kind === "PURCHASE_ARTWORK"
                  ? "The test-token payment above is part of this operation."
                  : "No token payment is included in this operation."}
              </dd>
            </div>
          </dl>
          {operation.kind === "PURCHASE_ARTWORK" && (
            <p className="xs mut mt-3 mb-0">
              A successful purchase changes digital ownership. Physical custody and
              artist authorship stay separate, and delivery is arranged afterwards.
            </p>
          )}
          <details className="more mt-2">
            <summary>Affected accounts and message commitment</summary>
            <p className="xs id mt-2 mb-0">Program: {state.program}</p>
            <p className="xs id mt-2 mb-0">Message: {operation.messageHash}</p>
            <ul className="xs m-0 mt-2 list-none p-0">
              {state.accounts.map((account, index) => (
                <li key={`${index}-${account.address}`} className="wrap-anywhere">
                  <span className="id">{account.address}</span> ·{" "}
                  {account.role & 1 ? "writable" : "read only"}
                  {account.role & 2 ? " · signer" : ""}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {state.signature && (
        <p className="sm mt-4 mb-0">
          Reference <span className="id">{state.signature}</span>
          {explorer && (
            <>
              {" "}
              <a
                className="lnk"
                href={explorer}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on a Solana explorer
                <span className="sr-only">, opens in a new tab</span>
              </a>
            </>
          )}
        </p>
      )}
      {state.error && (
        <p role="alert" className="ferr mt-3">
          {state.error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        {state.phase === "review" && (
          <button type="button" className="btn btn-p cut-s" onClick={onApprove}>
            Approve in wallet
          </button>
        )}
        {["unknown", "indexing-delay", "expired"].includes(state.phase) &&
          state.signature && (
            <button type="button" className="btn btn-p cut-s" onClick={onCheck}>
              Check status
            </button>
          )}
        {!state.signature && (
          <button type="button" className="lnk" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
