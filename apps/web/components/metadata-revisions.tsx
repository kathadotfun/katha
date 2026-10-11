"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  metadataDocumentSchema,
  type MetadataRevisionDocumentRequest,
} from "@katha/shared";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import {
  createMetadataRevisionWorkflow,
  emptyMetadataSnapshot,
  type MetadataRevisionWorkflow,
} from "../lib/metadata-revisions";
import { wordDiff } from "../lib/text-diff";
import { TransactionReviewView } from "./transaction-review";
import { OpsSignedOut, ReceiptLine, WorkflowIntro } from "./ops-ui";
import { Badge, FieldTag, Notice, type Tone } from "./ui/status";

const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyMetadataSnapshot;
const fields = {
  story: "Story",
  meaning: "Meaning",
  culturalContext: "Cultural context",
  creationProcess: "Creation process",
} as const;
type Content = MetadataRevisionDocumentRequest["publicContent"];
const contentOf = (document: { canonicalDocument: string } | null | undefined) =>
  document
    ? metadataDocumentSchema.parse(JSON.parse(document.canonicalDocument)).publicContent
    : null;

export function MetadataRevisionsPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<MetadataRevisionWorkflow | null>(null),
    [content, setContent] = useState<Content | null>(null),
    [comparing, setComparing] = useState(false),
    [publicConfirmed, setPublicConfirmed] = useState(false),
    [revisionConfirmed, setRevisionConfirmed] = useState(false);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const value = createMetadataRevisionWorkflow(
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
  useEffect(() => {
    setPublicConfirmed(false);
    setRevisionConfirmed(false);
    setComparing(false);
    setContent(contentOf(state.page?.metadata));
  }, [state.page, auth.session]);
  if (!auth.session)
    return (
      <OpsSignedOut path={`/admin/artworks/${kathaId}/metadata`} role="administrator" />
    );
  const page = state.page;
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
  const disabled = state.busy || state.reloadRequired || !free;
  const saved = contentOf(page?.metadata);
  const current = contentOf(page?.current);
  const unsaved = Boolean(
    content && saved && JSON.stringify(content) !== JSON.stringify(saved),
  );
  const base = current ?? saved;
  const changed =
    content && base
      ? (Object.keys(fields) as (keyof Content)[]).filter(
          (key) => content[key] !== base[key],
        )
      : [];
  const proposedReady =
    page?.metadata &&
    page.metadata.status === "PREPARED" &&
    page.metadata.documentHash !== page.chain.documentHash;
  const tx =
    flow.operation?.kind === "REVISE_METADATA" && flow.operation.kathaId === kathaId;
  const [tone, status]: [Tone, string] = !page
    ? state.error
      ? ["err", "Unavailable"]
      : ["neu", "Checking"]
    : page.revision.unresolved
      ? ["warn", "Outcome unknown"]
      : comparing
        ? ["info", "Reviewing changes"]
        : proposedReady && !unsaved
          ? ["info", "Ready to approve"]
          : unsaved
            ? ["neu", "Draft"]
            : ["ok", `Version ${page.chain.version} live`];
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <WorkflowIntro tone={tone} status={status}>
        The public story, meaning, cultural context and creation process change only
        through revisions. Every version is kept.{" "}
        {page?.chain.mode === "MINTED"
          ? "Because this work is minted, Katha's registry and the asset's metadata are updated together."
          : "The revision is committed to Katha's registry."}
      </WorkflowIntro>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking saved documents and finalized chain state…
        </p>
      )}
      {state.error && (
        <Notice tone="err">
          <p>{state.error}</p>
          {!page && (
            <button
              type="button"
              className="btn btn-o btn-sm self-start"
              disabled={state.busy}
              onClick={() => void workflow?.read()}
            >
              Reload saved state
            </button>
          )}
        </Notice>
      )}
      {page?.revision.unresolved && (
        <Notice tone="warn" icon="warning">
          <p>
            <strong>A saved revision transaction is unresolved.</strong> Reconcile it
            before preparing or editing another revision; don&apos;t start a new one.
          </p>
        </Notice>
      )}
      {page && !page.canSave && !page.revision.unresolved && (
        <Notice tone="info">
          <p>
            <strong>Editing isn&apos;t available yet.</strong> Wait for the finalized
            document to be indexed and the artist to be verified, then reload.
          </p>
        </Notice>
      )}
      {page && content && (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-col gap-5" style={{ flex: "999 1 640px" }}>
            {!comparing ? (
              <section
                className="panel cut panel-lg flex flex-col gap-4"
                aria-labelledby="metadata-controls"
              >
                <h2 id="metadata-controls" className="h2 h2-ops">
                  {unsaved || !proposedReady
                    ? `Draft version ${page.chain.version + 1}`
                    : `Saved draft, version ${page.chain.version + 1}`}
                </h2>
                <p className="help -mt-2">
                  Category, artist attribution, creation year, media and physical
                  details are kept from the approved document.
                </p>
                <fieldset
                  className="flex flex-col gap-4"
                  disabled={disabled || !page.canSave}
                >
                  <legend className="sr-only">Proposed public text</legend>
                  {(Object.keys(fields) as (keyof Content)[]).map((field) => (
                    <div key={field} className="fld">
                      <label htmlFor={`metadata-${field}`} className="lbl">
                        {fields[field]}
                        {base && content[field] !== base[field] && (
                          <FieldTag kind="changed" />
                        )}
                      </label>
                      <textarea
                        id={`metadata-${field}`}
                        className="inp"
                        rows={field === "story" ? 7 : 5}
                        maxLength={field === "story" ? 10000 : 5000}
                        required
                        value={content[field]}
                        onChange={(event) => {
                          setContent({ ...content, [field]: event.target.value });
                          setPublicConfirmed(false);
                          setRevisionConfirmed(false);
                        }}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-p cut-s self-start"
                    onClick={() => setComparing(true)}
                  >
                    Compare with current version
                  </button>
                </fieldset>
              </section>
            ) : (
              <form
                className="panel cut panel-lg flex flex-col gap-[18px]"
                aria-labelledby="metadata-compare"
                onSubmit={(event) => {
                  event.preventDefault();
                  void workflow?.save(content, publicConfirmed);
                }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <h2 id="metadata-compare" className="h2 h2-ops">
                    Version {page.chain.version} compared with draft{" "}
                    {page.chain.version + 1}
                  </h2>
                  <span className="sm mut">{changed.length} of 4 fields changed</span>
                </div>
                {changed.length === 0 && <p className="p">Nothing has changed yet.</p>}
                {changed.map((field) => {
                  const parts = wordDiff(base![field], content[field]);
                  return (
                    <div key={field} className="flex flex-col gap-2">
                      <h3 className="h3 text-[19px]">{fields[field]}</h3>
                      <div className="cmp">
                        <div className="cur cut-s">
                          <p className="xs mut mt-0 mb-1.5">
                            Current, version {page.chain.version}
                          </p>
                          {parts
                            .filter((part) => part.kind !== "added")
                            .map((part, index) =>
                              part.kind === "removed" ? (
                                <del key={index}>{part.text}</del>
                              ) : (
                                <span key={index}>{part.text}</span>
                              ),
                            )}
                        </div>
                        <div className="pro cut-s">
                          <p className="xs mut mt-0 mb-1.5">
                            Proposed, draft {page.chain.version + 1}
                          </p>
                          {parts
                            .filter((part) => part.kind !== "removed")
                            .map((part, index) =>
                              part.kind === "added" ? (
                                <ins key={index}>{part.text}</ins>
                              ) : (
                                <span key={index}>{part.text}</span>
                              ),
                            )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {changed.length > 0 && changed.length < 4 && (
                  <p className="sm mut m-0">
                    {(Object.keys(fields) as (keyof Content)[])
                      .filter((field) => !changed.includes(field))
                      .map((field) => fields[field])
                      .join(", ")}{" "}
                    unchanged.
                  </p>
                )}
                <label className="chk chk-box">
                  <input
                    type="checkbox"
                    checked={publicConfirmed}
                    disabled={disabled || !page.canSave}
                    onChange={(event) => setPublicConfirmed(event.target.checked)}
                  />
                  <span>
                    <strong>I approve this text for public display.</strong> It&apos;s
                    been checked with the artist where it describes their work, and
                    contains no private evidence or fulfillment details.
                  </span>
                </label>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    type="submit"
                    className="btn btn-p cut-s"
                    disabled={
                      disabled ||
                      !page.canSave ||
                      !publicConfirmed ||
                      changed.length === 0 ||
                      !unsaved
                    }
                  >
                    Save immutable revision
                  </button>
                  <button
                    type="button"
                    className="lnk"
                    onClick={() => setComparing(false)}
                  >
                    Keep editing
                  </button>
                </div>
                {!unsaved && changed.length > 0 && (
                  <p className="help">
                    This draft is already saved. Approve its transaction below.
                  </p>
                )}
              </form>
            )}

            {proposedReady && !unsaved && (
              <form
                className="panel cut panel-lg flex flex-col gap-3"
                aria-labelledby="metadata-revision-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void workflow?.prepare(revisionConfirmed);
                }}
              >
                <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
                  <h2 id="metadata-revision-title" className="h2 h2-ops">
                    Revision {page.chain.version + 1}
                  </h2>
                  <FieldTag kind="lock">Immutable</FieldTag>
                </div>
                <dl className="m-0">
                  <div className="kv kv-ops">
                    <dt>Fingerprint</dt>
                    <dd className="id">sha256 {page.metadata!.documentHash}</dd>
                  </div>
                  <div className="kv kv-ops">
                    <dt>Document</dt>
                    <dd className="id">{page.metadata!.uri}</dd>
                  </div>
                  <div className="kv kv-ops">
                    <dt>Updates</dt>
                    <dd>
                      {page.chain.mode === "MINTED" ? (
                        <>
                          Katha registry entry and asset{" "}
                          <span className="id">{page.chain.asset}</span>, in one
                          transaction
                        </>
                      ) : (
                        "Katha registry entry"
                      )}
                    </dd>
                  </div>
                </dl>
                <label className="chk chk-box">
                  <input
                    type="checkbox"
                    checked={revisionConfirmed}
                    disabled={disabled || !page.canSubmit}
                    onChange={(event) => setRevisionConfirmed(event.target.checked)}
                  />
                  <span>
                    I reviewed the saved document and the change from version{" "}
                    {page.chain.version} to {page.chain.version + 1}.
                  </span>
                </label>
                <button
                  type="submit"
                  className="btn btn-p cut-s self-start"
                  disabled={disabled || !page.canSubmit || !revisionConfirmed}
                >
                  Prepare metadata revision
                </button>
              </form>
            )}
            {page.revision.receipt && (
              <ReceiptLine
                receipt={page.revision.receipt}
                cluster={page.cluster}
                label="Saved revision transaction"
              />
            )}
            {tx && (
              <TransactionReviewView
                id="metadata-transaction-review"
                title="Revision transaction"
                state={flow}
                onApprove={() => void transactions?.approveAndSend()}
                onCheck={() => void transactions?.checkConfirmation()}
                onCancel={() => transactions?.cancel()}
              />
            )}
            {page.revision.receipt?.status === "FINALIZED" &&
              page.revision.receipt.indexed && (
                <Link
                  className="btn btn-o cut-s self-start"
                  href={`/art/${page.kathaId}`}
                >
                  View public record
                </Link>
              )}
          </div>
          <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
            <section className="panel cut-s" aria-labelledby="metadata-versions">
              <h2 id="metadata-versions" className="h3">
                Versions
              </h2>
              <ol className="vl mt-2.5" reversed>
                {page.metadata &&
                  page.metadata.documentHash !== page.chain.documentHash && (
                    <li>
                      <span className="flex flex-wrap items-center gap-2">
                        <strong>Version {page.chain.version + 1}</strong>
                        <Badge tone="info" marker={false}>
                          Saved, not recorded
                        </Badge>
                      </span>
                      <span className="xs id">sha256 {page.metadata.documentHash}</span>
                    </li>
                  )}
                <li>
                  <span className="flex flex-wrap items-center gap-2">
                    <strong>Version {page.chain.version}</strong>
                    <Badge tone="ok" marker={false}>
                      Current
                    </Badge>
                  </span>
                  <span className="xs id">
                    {page.chain.documentHash
                      ? `sha256 ${page.chain.documentHash}`
                      : "Not initialized"}
                  </span>
                  {page.current && (
                    <details className="more">
                      <summary className="xs">View</summary>
                      <pre className="xs inset mt-2 overflow-x-auto whitespace-pre-wrap wrap-anywhere">
                        {page.current.canonicalDocument}
                      </pre>
                    </details>
                  )}
                </li>
              </ol>
              <p className="xs mut mt-2.5 mb-0">
                Earlier versions are never deleted; their commitments stay in the
                artwork&apos;s history. The public record shows the current one.
              </p>
            </section>
            <button
              type="button"
              className="lnk self-start"
              disabled={state.busy}
              onClick={() => void workflow?.read()}
            >
              Reload saved state
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
