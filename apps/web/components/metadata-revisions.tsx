"use client";
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
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyMetadataSnapshot;
const fields = {
  story: "Artwork story",
  meaning: "Meaning",
  culturalContext: "Cultural context",
  creationProcess: "Creation process",
} as const;
type Content = MetadataRevisionDocumentRequest["publicContent"];
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
    setContent(
      state.page?.metadata
        ? metadataDocumentSchema.parse(
            JSON.parse(state.page.metadata.canonicalDocument),
          ).publicContent
        : null,
    );
  }, [state.page, auth.session]);
  if (!auth.session)
    return (
      <p role="status" className="mt-10">
        Connect and sign in with an administrator wallet to review metadata revisions.
      </p>
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
  const unsaved =
    content &&
    page?.metadata &&
    JSON.stringify(content) !==
      JSON.stringify(
        metadataDocumentSchema.parse(JSON.parse(page.metadata.canonicalDocument))
          .publicContent,
      );
  const currentContent = page?.current
    ? metadataDocumentSchema.parse(JSON.parse(page.current.canonicalDocument))
        .publicContent
    : null;
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="metadata-controls"
      aria-busy={state.busy}
    >
      <h2 id="metadata-controls" className="text-2xl">
        Review and revise public documentation
      </h2>
      <p className="mt-4 text-muted">
        Preserve the artist’s attribution and permanent artwork identity while refining
        its public story. Approve public storage first, then review the change and
        approve the transaction in your wallet.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking saved documents and finalized chain state…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      <button
        type="button"
        className="text-link mt-5 min-h-12"
        disabled={state.busy}
        onClick={() => void workflow?.read()}
      >
        Reload saved state
      </button>
      {page && (
        <div className="mt-6 min-w-0">
          <h3 className="text-xl">{page.title}</h3>
          <p className="mt-3">
            {page.kathaId} · {page.cluster}
          </p>
          <p className="mt-4">
            Artwork category, artist attribution, creation year, media and physical
            details are retained from the approved document.
          </p>
          <dl className="mt-5 space-y-3 break-all text-sm">
            <dt>Permanent artist identity</dt>
            <dd>{page.identity?.artistId}</dd>
            <dt>Registration authority</dt>
            <dd>{page.chain.registrationAuthority}</dd>
            <dt>Core asset</dt>
            <dd>{page.chain.asset ?? "Unminted"}</dd>
            <dt>Current on-chain version</dt>
            <dd>{page.chain.version}</dd>
            <dt>Current commitment</dt>
            <dd>{page.chain.documentHash ?? "Not initialized"}</dd>
            <dt>Current URI</dt>
            <dd>{page.chain.uri ?? "Not initialized"}</dd>
            <dt>Proposed document</dt>
            <dd>
              Local version {page.metadata?.version} · {page.metadata?.status}
            </dd>
            <dt>Proposed commitment</dt>
            <dd>{page.metadata?.documentHash}</dd>
            <dt>Proposed URI</dt>
            <dd>{page.metadata?.uri}</dd>
          </dl>
          {page.revision.unresolved && (
            <p role="status" className="mt-5">
              Reconcile the retained signature before preparing or editing another
              revision.
            </p>
          )}
          {!page.canSave && !page.revision.unresolved && (
            <p role="status" className="mt-5">
              Wait for finalized document indexing and verified artist state, then
              reload.
            </p>
          )}
          {page.revision.receipt && (
            <p className="mt-4 break-all text-sm">
              Revision signature: {page.revision.receipt.signature} ·{" "}
              {page.revision.receipt.status} ·{" "}
              {page.revision.receipt.indexed ? "Indexed" : "Awaiting indexing"}
            </p>
          )}
          {content && (
            <form
              className="mt-6 space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                void workflow?.save(content, publicConfirmed);
              }}
            >
              {Object.entries(fields).map(([key, label]) => {
                const field = key as keyof Content;
                return (
                  <div key={field}>
                    {currentContent && (
                      <div className="mb-3">
                        <p className="eyebrow">Current {label.toLowerCase()}</p>
                        <p className="mt-2 whitespace-pre-wrap">
                          {currentContent[field]}
                        </p>
                      </div>
                    )}
                    <label htmlFor={`metadata-${field}`} className="block">
                      Proposed {label.toLowerCase()}
                    </label>
                    <textarea
                      id={`metadata-${field}`}
                      className="mt-2 min-h-32 w-full border border-muted bg-transparent p-3"
                      maxLength={field === "story" ? 10000 : 5000}
                      required
                      value={content[field]}
                      disabled={disabled || !page.canSave}
                      onChange={(event) => {
                        setContent({ ...content, [field]: event.target.value });
                        setPublicConfirmed(false);
                        setRevisionConfirmed(false);
                      }}
                    />
                  </div>
                );
              })}
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={publicConfirmed}
                  disabled={disabled || !page.canSave}
                  onChange={(event) => setPublicConfirmed(event.target.checked)}
                />
                <span>
                  I approve these story fields for public storage and confirm they
                  contain no private evidence or personal fulfillment information.
                </span>
              </label>
              <button
                type="submit"
                className="min-h-12 border border-muted px-4"
                disabled={disabled || !page.canSave || !publicConfirmed}
              >
                Save public document revision
              </button>
            </form>
          )}
          {(
            [
              ["Current document", page.current],
              ["Proposed saved document", page.metadata],
            ] as const
          ).map(
            ([label, document]) =>
              document && (
                <details className="mt-6" key={label}>
                  <summary className="min-h-12 cursor-pointer">
                    {label}: exact public bytes
                  </summary>
                  <pre className="mt-4 whitespace-pre-wrap break-all text-xs">
                    {document.canonicalDocument}
                  </pre>
                </details>
              ),
          )}
          <form
            className="mt-6"
            onSubmit={(event) => {
              event.preventDefault();
              void workflow?.prepare(revisionConfirmed);
            }}
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0"
                checked={revisionConfirmed}
                disabled={disabled || !page.canSubmit || Boolean(unsaved)}
                onChange={(event) => setRevisionConfirmed(event.target.checked)}
              />
              <span>
                I reviewed the saved document and commitment change from version{" "}
                {page.chain.version} to {page.chain.version + 1}.{" "}
                {page.chain.mode === "MINTED"
                  ? "Update the Core URI and Registry commitment together."
                  : "Commit the public document to the Registry."}
              </span>
            </label>
            <button
              type="submit"
              className="mt-5 min-h-12 border border-muted px-4"
              disabled={
                disabled || !page.canSubmit || !revisionConfirmed || Boolean(unsaved)
              }
            >
              Prepare metadata revision
            </button>
          </form>
        </div>
      )}
      {flow.operation?.kind === "REVISE_METADATA" &&
        flow.operation.kathaId === kathaId && (
          <TransactionReviewView
            id="metadata-transaction-review"
            title="Metadata transaction review"
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}
    </section>
  );
}
