"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  conditionGradeSchema,
  conditionPreparationRequestSchema,
  conditionReasonSchema,
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
import { localDateTime, shortAddress } from "../lib/format";
import { gradeLabels, reasonLabels } from "./artwork-care";
import { TransactionReviewView } from "./transaction-review";
import { ResaleInspectionPanel } from "./resale-inspection";
import { OpsSignedOut, ReceiptLine, WorkflowIntro } from "./ops-ui";
import { FieldTag, Notice, type Tone } from "./ui/status";

const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyConditionSnapshot;
const custodyText = {
  UNKNOWN: "Not recorded",
  KATHA_HELD: "Held by Katha",
  COLLECTOR_HELD: "With the owner",
  IN_TRANSIT: "In transit",
};

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
      <OpsSignedOut path={`/admin/artworks/${kathaId}/condition`} role="verifier" />
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
  const page = state.page;
  const [tone, status]: [Tone, string] = !page
    ? state.error
      ? ["err", "Unavailable"]
      : ["neu", "Checking"]
    : page.attestation.finalized
      ? ["ok", "Recorded"]
      : page.unresolved || page.attestation.unresolved
        ? ["warn", "Outcome unknown"]
        : page.report?.status === "PREPARED"
          ? ["info", "Report prepared"]
          : ["neu", "No new report"];
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <WorkflowIntro tone={tone} status={status}>
        Inspect the work in person. Notes and evidence images stay private; the
        report&apos;s fingerprint, grade, reason and inspection time are recorded on
        chain. A report doesn&apos;t change authorship, ownership or physical custody.
      </WorkflowIntro>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking inspection state…
        </p>
      )}
      {state.error && (
        <Notice tone="err">
          <p>{state.error}</p>
          {!page && (
            <button
              className="btn btn-o btn-sm self-start"
              type="button"
              disabled={state.busy || !workflow}
              onClick={() => void workflow?.read()}
            >
              Reload inspection state
            </button>
          )}
        </Notice>
      )}
      {page && (
        <InspectionContent
          key={`${auth.session.walletId}:${auth.session.expiresAt}:${page.updatedAt}:${page.report?.id}`}
          page={page}
          kathaId={kathaId}
          inspectorId={auth.session.walletId}
          workflow={workflow}
          busy={state.busy}
          disabled={
            state.busy ||
            state.reloadRequired ||
            !free ||
            page.unresolved ||
            page.attestation.unresolved
          }
        />
      )}
      {flow.operation?.kind === "RECORD_CONDITION" &&
        flow.operation.kathaId === kathaId && (
          <TransactionReviewView
            id="condition-transaction"
            title="Condition report transaction"
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}
    </div>
  );
}

function InspectionContent({
  page,
  kathaId,
  inspectorId,
  workflow,
  disabled,
  busy,
}: {
  page: ConditionInspectionReview;
  kathaId: string;
  inspectorId: string;
  workflow: ConditionInspectionWorkflow | null;
  disabled: boolean;
  busy: boolean;
}) {
  const [file, setFile] = useState<File | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [grade, setGrade] = useState<string>(""),
    [reason, setReason] = useState<string>(page.chain.allowedReasons[0] ?? ""),
    [inspector, setInspector] = useState(inspectorId),
    [inspectedAt, setInspectedAt] = useState(""),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [attest, setAttest] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [reportId, setReportId] = useState<string | null>(null);
  const receipt = page.attestation.receipt;
  const scope = page.chain.scope;
  function prepare() {
    const next: Record<string, string> = {};
    if (!grade) next.grade = "Choose a grade.";
    const inspected = new Date(inspectedAt);
    if (
      !inspectedAt ||
      !Number.isFinite(inspected.getTime()) ||
      inspected.getTime() > Date.now()
    )
      next.inspectedAt =
        "Enter when the inspection actually happened. It can't be in the future.";
    if (!notes.trim()) next.notes = "Add your observations. They stay private.";
    if (!selected.length) next.evidence = "Select at least one evidence image.";
    if (!confirmed) next.confirmed = "Confirm that you inspected the work in person.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    const id = reportId ?? crypto.randomUUID();
    setReportId(id);
    // Chain timestamps use exact seconds. The form shows the browser's local time.
    inspected.setMilliseconds(0);
    const input = conditionPreparationRequestSchema.safeParse({
      expectedUpdatedAt: page.updatedAt,
      reportId: id,
      inspectorId: inspector.trim(),
      grade,
      reason,
      inspectedAt: inspected.toISOString(),
      reportedAt: new Date().toISOString(),
      notes,
      mediaIds: selected,
      ...(scope ? { scope } : {}),
    });
    if (!input.success) {
      setErrors({
        inspector: "Check the inspector record ID, notes and selected evidence.",
      });
      return;
    }
    setErrors({});
    void workflow?.prepareDocument(input.data, confirmed);
  }
  const count = Object.keys(errors).length;
  return (
    <>
      {page.unresolved && (
        <Notice tone="warn" icon="warning">
          <p>
            <strong>A saved report transaction is unresolved.</strong> Reload to check
            its outcome before uploading evidence or creating a replacement report.
          </p>
        </Notice>
      )}
      <div
        className="grid items-start gap-5"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))",
        }}
      >
        <section className="panel cut" aria-labelledby="condition-scope">
          <h2 id="condition-scope" className="h3">
            Scope of this inspection
          </h2>
          <dl className="mt-3 mb-0">
            <div className="kv kv-ops">
              <dt>Artwork</dt>
              <dd>
                {page.title}, <span className="id">{page.kathaId}</span>
              </dd>
            </div>
            <div className="kv kv-ops">
              <dt>Current owner</dt>
              <dd className="id">
                {scope ? scope.ownerWallet : "Not minted; no collector owner"}
              </dd>
            </div>
            <div className="kv kv-ops">
              <dt>Physical custody</dt>
              <dd>
                {scope
                  ? `${custodyText[scope.custodyState]}, revision ${scope.custodyRevision}`
                  : "Not applicable yet"}
              </dd>
            </div>
            <div className="kv kv-ops">
              <dt>Latest version</dt>
              <dd>
                Version {page.chain.version}, observed{" "}
                {localDateTime(page.chain.observedAt)}
              </dd>
            </div>
            <div className="kv kv-ops">
              <dt>Applies to</dt>
              <dd>
                This owner and custody. If either changes, a new inspection is needed
                for resale.
              </dd>
            </div>
          </dl>
        </section>
        <ResaleInspectionPanel kathaId={kathaId} verifier />
      </div>

      <div className="workflow-layout">
        <section
          className="panel cut panel-lg flex min-w-0 flex-col gap-5"
          aria-labelledby="inspection-controls"
        >
          <h2 id="inspection-controls" className="h2 h2-ops">
            New inspection report
          </h2>
          {count > 0 && (
            <Notice tone="err">
              <p>
                <strong>
                  {count === 1 ? "1 thing needs" : `${count} things need`} attention.
                </strong>{" "}
                Your notes and evidence are kept.
              </p>
            </Notice>
          )}
          <fieldset className="flex flex-col gap-5" disabled={disabled}>
            <legend className="sr-only">Prepare a new immutable report</legend>
            <fieldset className="fld">
              <legend className="lbl mb-2">
                Grade <FieldTag kind="req" />
              </legend>
              <div className="choice">
                {conditionGradeSchema.options.map((value) => (
                  <label key={value} className="cut-s">
                    <input
                      type="radio"
                      name="condition-grade"
                      value={value}
                      checked={grade === value}
                      onChange={() => setGrade(value)}
                    />
                    {gradeLabels[value]}
                  </label>
                ))}
              </div>
              {errors.grade && <p className="ferr">{errors.grade}</p>}
            </fieldset>
            <div className="g2">
              <div className="fld">
                <label className="lbl" htmlFor="condition-reason">
                  Reason <FieldTag kind="req" />
                </label>
                <select
                  id="condition-reason"
                  className="inp"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-describedby="condition-reason-help"
                >
                  {conditionReasonSchema.options.map((value) => {
                    const allowed = page.chain.allowedReasons.includes(value);
                    return (
                      <option key={value} value={value} disabled={!allowed}>
                        {reasonLabels[value]}
                        {allowed ? "" : " (not available now)"}
                      </option>
                    );
                  })}
                </select>
                <p id="condition-reason-help" className="help">
                  Only reasons that fit this work&apos;s current owner and custody can
                  be chosen.
                </p>
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="condition-inspector">
                  Inspector record ID <FieldTag kind="req" />
                </label>
                <input
                  id="condition-inspector"
                  className="inp id font-medium"
                  value={inspector}
                  onChange={(event) => setInspector(event.target.value)}
                  maxLength={36}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={errors.inspector ? true : undefined}
                />
                {errors.inspector && <p className="ferr">{errors.inspector}</p>}
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="condition-time">
                  Inspected at <FieldTag kind="req" />
                </label>
                <input
                  id="condition-time"
                  className="inp"
                  type="datetime-local"
                  step="1"
                  value={inspectedAt}
                  onChange={(event) => setInspectedAt(event.target.value)}
                  aria-invalid={errors.inspectedAt ? true : undefined}
                  aria-describedby="condition-time-help"
                />
                {errors.inspectedAt && <p className="ferr">{errors.inspectedAt}</p>}
                <p id="condition-time-help" className="help">
                  When you examined the work, in your local time, not when you&apos;re
                  filing this.
                </p>
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="condition-notes">
                Notes <FieldTag kind="priv" />
              </label>
              <textarea
                id="condition-notes"
                className="inp"
                rows={5}
                maxLength={5000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                aria-invalid={errors.notes ? true : undefined}
                aria-describedby="condition-notes-help"
              />
              {errors.notes && <p className="ferr">{errors.notes}</p>}
              <p id="condition-notes-help" className="help">
                Notes stay private. Only the report&apos;s fingerprint is recorded.
              </p>
            </div>
            <fieldset className="fld">
              <legend className="lbl mb-2">
                Evidence <FieldTag kind="priv" />
              </legend>
              <div className="flex flex-col gap-2.5">
                {page.media.length === 0 && (
                  <p className="p sm">No private condition images saved yet.</p>
                )}
                {page.media.map((item, index) => (
                  <label key={item.id} className="chk">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        )
                      }
                    />
                    <span className="min-w-0">
                      Evidence image {index + 1}, {item.mimeType}
                      <span className="xs id block font-medium">
                        sha256 {item.contentHash}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.evidence && <p className="ferr">{errors.evidence}</p>}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="fld" style={{ flex: "1 1 260px" }}>
                  <label className="lbl" htmlFor="condition-upload">
                    Add an evidence image
                  </label>
                  <input
                    id="condition-upload"
                    className="inp"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/avif"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    aria-describedby="condition-upload-help"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-o btn-sm mb-0.5"
                  disabled={
                    !file || file.size < 1 || file.size > ARTWORK_MEDIA_MAX_BYTES
                  }
                  onClick={() => {
                    if (file) void workflow?.upload(file);
                  }}
                >
                  Upload private evidence
                </button>
              </div>
              <p id="condition-upload-help" className="help">
                PNG, JPEG, WebP or AVIF, up to {ARTWORK_MEDIA_MAX_BYTES / 1024 / 1024}{" "}
                MiB each. Evidence stays private and doesn&apos;t change public media.
              </p>
            </fieldset>
            <label className="chk chk-box">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                aria-invalid={errors.confirmed ? true : undefined}
              />
              <span>
                <strong>I inspected this work in person</strong> at the time above, and
                this report reflects what I saw for the scope shown.
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <button type="button" className="btn btn-p cut-s" onClick={prepare}>
                {busy ? "Preparing…" : "Prepare report"}
              </button>
              <p className="xs mut m-0 max-w-[30rem]">
                Preparing saves a private report; it doesn&apos;t sign anything. A
                recorded report can&apos;t be edited; a later inspection becomes a new
                version.
              </p>
            </div>
          </fieldset>
        </section>

        <section
          className="panel cut flex min-w-0 flex-col gap-3"
          aria-labelledby="condition-report"
          style={{ flex: "1 1 340px" }}
        >
          <h2 id="condition-report" className="h3">
            Report and transaction
          </h2>
          {page.report ? (
            <>
              <dl className="m-0">
                <div className="kv kv-ops">
                  <dt>Report</dt>
                  <dd>
                    Version {page.report.version}{" "}
                    <FieldTag kind="lock">Immutable</FieldTag>
                  </dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Status</dt>
                  <dd>
                    {page.report.status === "PREPARED"
                      ? "Prepared, not yet recorded"
                      : "Recorded"}
                  </dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Fingerprint</dt>
                  <dd className="id">sha256 {page.report.documentHash}</dd>
                </div>
              </dl>
              <details className="more">
                <summary>View private report</summary>
                <pre className="xs inset mt-2 overflow-x-auto whitespace-pre-wrap wrap-anywhere">
                  {page.report.canonicalDocument}
                </pre>
              </details>
              <fieldset
                className="flex flex-col gap-3"
                disabled={
                  disabled ||
                  page.report.status !== "PREPARED" ||
                  page.attestation.finalized
                }
              >
                <label className="chk chk-box">
                  <input
                    type="checkbox"
                    checked={attest}
                    onChange={(event) => setAttest(event.target.checked)}
                  />
                  <span>
                    I reviewed the exact saved report and its fingerprint, and approve
                    recording it on chain.
                  </span>
                </label>
                <button
                  type="button"
                  className="btn btn-p cut-s self-start"
                  disabled={!attest}
                  onClick={() => {
                    setAttest(false);
                    void workflow?.prepareAttestation(attest);
                  }}
                >
                  Prepare and simulate the report transaction
                </button>
              </fieldset>
            </>
          ) : (
            <p className="p sm">
              No new report yet. Prepare one with the form; it appears here for review.
            </p>
          )}
          {receipt && (
            <ReceiptLine
              receipt={receipt}
              cluster={page.cluster}
              label="Saved report transaction"
            />
          )}
          {page.attestation.finalized && scope && (
            <p className="p sm" role="status">
              Recorded for owner{" "}
              <span className="id">{shortAddress(scope.ownerWallet)}</span>. A resale
              approval applies only while this owner and custody stay unchanged.
            </p>
          )}
          <button
            type="button"
            className="lnk self-start"
            disabled={busy || !workflow}
            onClick={() => void workflow?.read()}
          >
            Reload inspection state
          </button>
        </section>
      </div>
    </>
  );
}
