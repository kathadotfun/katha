"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  conditionGradeSchema,
  conditionPreparationRequestSchema,
  ARTWORK_MEDIA_MAX_BYTES,
  type ConditionInspectionReview,
} from "@katha/shared";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import {
  createConditionInspectionWorkflow,
  emptyConditionSnapshot,
  type ConditionInspectionWorkflow,
} from "../lib/condition-inspection";
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyConditionSnapshot;
const inputClass =
  "mt-2 block w-full min-w-0 min-h-12 border border-muted bg-surface px-3 py-2";
export function ConditionInspectionPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<ConditionInspectionWorkflow | null>(null);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const value = createConditionInspectionWorkflow(
      session,
      connection,
      transactions,
      kathaId,
    );
    setWorkflow(value);
    return () => value.dispose();
  }, [session, connection, transactions, kathaId]);
  useEffect(() => {
    if (auth.status === "signed-in") void workflow?.read();
  }, [workflow, auth.status, auth.session]);
  const state = useSyncExternalStore(
    workflow?.subscribe ?? noop,
    workflow?.getSnapshot ?? emptyPage,
    emptyPage,
  );
  const flow = useSyncExternalStore(
    transactions?.subscribe ?? noop,
    transactions?.getSnapshot ?? emptyFlow,
    emptyFlow,
  );
  if (!auth.session)
    return (
      <p role="status" className="mt-10">
        Connect and sign in with a verifier wallet in the header to record an
        inspection.
      </p>
    );
  const free =
    [
      "idle",
      "not-completed",
      "failed",
      "expired",
      "indexing-delay",
      "indexed",
    ].includes(flow.phase) &&
    (!flow.signature || ["failed", "indexing-delay", "indexed"].includes(flow.phase));
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="inspection-controls"
      aria-busy={state.busy}
    >
      <h2 id="inspection-controls" className="text-2xl">
        Physical condition inspection
      </h2>
      <p className="mt-4 text-sm text-muted">
        Inspect the artwork in person. Evidence images and notes stay private; the
        report’s hash, grade, reason and inspection time are attested on chain. This
        report does not change authorship, ownership or physical custody.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking inspection state…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      <button
        className="text-link mt-4"
        type="button"
        disabled={state.busy || !workflow}
        onClick={() => void workflow?.read()}
      >
        Reload inspection state
      </button>
      {state.page && (
        <InspectionContent
          key={`${auth.session.walletId}:${auth.session.expiresAt}:${state.page.updatedAt}:${state.page.report?.id}`}
          page={state.page}
          inspectorId={auth.session.walletId}
          workflow={workflow}
          disabled={
            state.busy ||
            state.reloadRequired ||
            !free ||
            state.page.unresolved ||
            state.page.attestation.unresolved
          }
        />
      )}
      {flow.operation?.kind === "RECORD_CONDITION" &&
        flow.operation.kathaId === kathaId && (
          <TransactionReviewView
            id="condition-transaction"
            title="Condition attestation transaction review"
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}
    </section>
  );
}
function InspectionContent({
  page,
  inspectorId,
  workflow,
  disabled,
}: {
  page: ConditionInspectionReview;
  inspectorId: string;
  workflow: ConditionInspectionWorkflow | null;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [grade, setGrade] = useState<string>("GOOD"),
    [reason, setReason] = useState<string>(page.chain.allowedReasons[0]!),
    [inspector, setInspector] = useState(inspectorId),
    [inspectedAt, setInspectedAt] = useState(""),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [attest, setAttest] = useState(false),
    [error, setError] = useState<string | null>(null),
    [reportId, setReportId] = useState<string | null>(null);
  const receipt = page.attestation.receipt;
  function prepare() {
    const id = reportId ?? crypto.randomUUID();
    setReportId(id);
    const inspected = new Date(inspectedAt);
    if (!Number.isFinite(inspected.getTime())) {
      setError("Enter the actual inspection date and time.");
      return;
    }
    // Chain timestamps use exact seconds. The UI displays the browser's local timezone.
    inspected.setMilliseconds(0);
    const input = conditionPreparationRequestSchema.safeParse({
      expectedUpdatedAt: page.updatedAt,
      reportId: id,
      inspectorId: inspector,
      grade,
      reason,
      inspectedAt: inspected.toISOString(),
      reportedAt: new Date().toISOString(),
      notes,
      mediaIds: selected,
      ...(page.chain.scope ? { scope: page.chain.scope } : {}),
    });
    if (!input.success || inspected.getTime() > Date.now()) {
      setError(
        "Check the inspector UUID, time, notes and one or more distinct evidence images.",
      );
      return;
    }
    setError(null);
    void workflow?.prepareDocument(input.data, confirmed);
  }
  return (
    <>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt>Artwork</dt>
          <dd>
            {page.title} · {page.kathaId}
          </dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>
            {page.cluster === "devnet" ? "Devnet" : "Localnet"} · Test environment
          </dd>
        </div>
        <div>
          <dt>Finalized condition version</dt>
          <dd>{page.chain.version}</dd>
        </div>
        <div>
          <dt>Scope observed at</dt>
          <dd>{page.chain.observedAt}</dd>
        </div>
        <div>
          <dt>Ownership and custody scope</dt>
          <dd className="break-all">
            {page.chain.scope
              ? `${page.chain.scope.ownerWallet} · ${page.chain.scope.custodyState} · Revision ${page.chain.scope.custodyRevision}`
              : "Unminted artwork; no collector ownership scope"}
          </dd>
        </div>
      </dl>
      <p className="mt-4 text-sm">
        Owner, custody and condition version are checked again when preparing the
        transaction. A sale or custody change requires a new review.
      </p>
      {page.unresolved && (
        <p role="status" className="mt-4">
          A retained condition signature is unresolved. Check its outcome before
          uploading evidence or creating a replacement report.
        </p>
      )}
      {receipt && (
        <div role="status" className="mt-4 text-sm">
          <p className="break-all">Retained condition signature: {receipt.signature}</p>
          <p>Receipt: {receipt.status}</p>
          <p>
            {receipt.status === "FINALIZED"
              ? receipt.indexed
                ? "Condition event indexed."
                : "Finalized; condition indexing pending."
              : "A signature alone does not establish a successful attestation."}
          </p>
        </div>
      )}
      <fieldset disabled={disabled} className="mt-8 space-y-4">
        <legend className="text-xl">Append private inspection evidence</legend>
        <p className="text-sm">
          PNG, JPEG, WebP or AVIF, up to {ARTWORK_MEDIA_MAX_BYTES / 1024 / 1024} MiB
          each. Existing artwork media and metadata remain unchanged. Store originals in
          approved private storage.
        </p>
        <label className="block">
          Inspection image
          <input
            className={inputClass}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="button-primary"
          disabled={!file || file.size < 1 || file.size > ARTWORK_MEDIA_MAX_BYTES}
          onClick={() => {
            if (file) void workflow?.upload(file);
          }}
        >
          Upload private evidence
        </button>
      </fieldset>
      <fieldset disabled={disabled} className="mt-8 space-y-4">
        <legend className="text-xl">Prepare a new immutable report</legend>
        <label className="block">
          Condition grade
          <select
            className={inputClass}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          >
            {conditionGradeSchema.options.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Inspection reason
          <select
            className={inputClass}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {page.chain.allowedReasons.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Inspector record UUID
          <input
            className={inputClass}
            value={inspector}
            onChange={(e) => setInspector(e.target.value)}
            maxLength={36}
            autoComplete="off"
          />
        </label>
        <label className="block">
          Actual inspection date and time (your local timezone)
          <input
            className={inputClass}
            type="datetime-local"
            step="1"
            value={inspectedAt}
            onChange={(e) => setInspectedAt(e.target.value)}
          />
        </label>
        <label className="block">
          Private condition notes
          <textarea
            className={inputClass}
            rows={5}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <p className="text-sm">
          Select evidence by its saved SHA-256 digest. Evidence bytes are checked before
          the report is saved.
        </p>
        {page.media.length === 0 && <p>No private condition images saved yet.</p>}
        {page.media.map((item, index) => (
          <label key={item.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(item.id)}
              onChange={(e) =>
                setSelected((current) =>
                  e.target.checked
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
            />
            <span className="min-w-0 text-sm">
              Evidence {index + 1} · {item.mimeType}
              <span className="block break-all font-mono">{item.contentHash}</span>
            </span>
          </label>
        ))}
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I physically inspected this artwork and approve these notes, grade, reason,
            time and selected evidence for the displayed scope.
          </span>
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          type="button"
          className="button-primary"
          disabled={!confirmed || !selected.length || !notes.trim() || !inspectedAt}
          onClick={prepare}
        >
          Save private condition report
        </button>
        <p className="text-sm">
          Saving does not sign or submit a transaction. Earlier reports remain
          preserved. Reload after an uncertain save before creating a replacement.
        </p>
      </fieldset>
      {page.report && (
        <div className="mt-8">
          <h3 className="text-xl">
            Saved private report · Version {page.report.version}
          </h3>
          <p className="mt-3 text-sm">
            {page.report.status} · {page.report.id}
          </p>
          <p className="mt-3 break-all font-mono text-sm">{page.report.documentHash}</p>
          <details className="mt-4">
            <summary>Review exact private canonical report</summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-sm">
              {page.report.canonicalDocument}
            </pre>
          </details>
          <fieldset
            className="mt-6 space-y-4"
            disabled={
              disabled ||
              page.report.status !== "PREPARED" ||
              page.attestation.finalized
            }
          >
            <legend className="text-xl">Attest to the reviewed report</legend>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={attest}
                onChange={(e) => setAttest(e.target.checked)}
              />
              <span>
                I reviewed the exact saved report and hash and approve its on-chain
                condition attestation.
              </span>
            </label>
            <button
              type="button"
              className="button-primary"
              disabled={!attest}
              onClick={() => {
                setAttest(false);
                void workflow?.prepareAttestation(attest);
              }}
            >
              Prepare and simulate condition attestation
            </button>
          </fieldset>
        </div>
      )}
    </>
  );
}
