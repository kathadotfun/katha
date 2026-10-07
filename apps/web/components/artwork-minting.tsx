"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import {
  createArtworkMintingWorkflow,
  emptyMintSnapshot,
  type ArtworkMintingWorkflow,
} from "../lib/artwork-minting";
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyMintSnapshot;
const reasons = {
  ARTIST_UNVERIFIED: "The artist profile must be verified.",
  DOCUMENTS_MISSING: "Prepare public metadata and an initial condition report.",
  CHAIN_PREREQUISITES:
    "Finalize artwork registration, verification, metadata, initial inspection and held custody before minting.",
  AUTHORITY_REQUIRED: "Connect the configured registration authority to mint.",
  UNRESOLVED_MINT: "Reconcile the retained mint signature before continuing.",
  OTHER_RESERVATION:
    "An existing mint preparation belongs to another wallet. Reconcile it before continuing.",
  INDEXING_PENDING:
    "Wait for finalized mint, verification, inspection, metadata and ownership indexing, then reload saved state.",
};
export function ArtworkMintingPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<ArtworkMintingWorkflow | null>(null),
    [mintConfirmed, setMintConfirmed] = useState(false),
    [publicationConfirmed, setPublicationConfirmed] = useState(false);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const value = createArtworkMintingWorkflow(
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
    setMintConfirmed(false);
    setPublicationConfirmed(false);
  }, [state.page, auth.session]);
  if (!auth.session)
    return (
      <p role="status" className="mt-10">
        Connect and sign in with an administrator wallet in the header to review minting
        and publication.
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
  const disabled = state.busy || state.reloadRequired || !free,
    page = state.page;
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="mint-controls"
      aria-busy={state.busy}
    >
      <h2 id="mint-controls" className="text-2xl">
        Mint and publish
      </h2>
      <p className="mt-4 text-muted">
        Review the documented artwork before creating its permanent Core asset. Mint
        approval uses your wallet. Publication is a separate administrator action after
        finalized indexing.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking saved artwork and finalized chain state…
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
            {page.kathaId} · {page.cluster} ·{" "}
            {page.published ? "Published" : "Unpublished"}
          </p>
          {page.blockedReasons.length > 0 && (
            <ul className="mt-5 space-y-3" aria-live="polite">
              {page.blockedReasons.map((reason) => (
                <li key={reason}>{reasons[reason]}</li>
              ))}
            </ul>
          )}
          {page.chain && (
            <dl className="mt-5 space-y-3 break-all text-sm">
              <dt>Core asset</dt>
              <dd>
                {page.chain.asset} ·{" "}
                {page.chain.minted ? "Finalized binding found" : "Not minted"}
              </dd>
              <dt>Collection</dt>
              <dd>{page.chain.collection}</dd>
              <dt>Registration authority and initial digital owner</dt>
              <dd>{page.chain.registrationAuthority}</dd>
              <dt>Current digital owner</dt>
              <dd>{page.chain.owner ?? "Created on mint"}</dd>
              <dt>Physical custody</dt>
              <dd>
                {page.chain.custodyState.toLowerCase().replaceAll("_", " ")} · revision{" "}
                {page.chain.custodyRevision}
              </dd>
              <dt>Metadata and condition versions</dt>
              <dd>
                {page.chain.metadataVersion} / {page.chain.conditionVersion}
              </dd>
            </dl>
          )}
          {page.metadata && (
            <details className="mt-6">
              <summary className="min-h-12 cursor-pointer">
                Review exact public metadata
              </summary>
              <p className="mt-3 break-all text-sm">
                SHA-256: {page.metadata.documentHash}
              </p>
              <p className="mt-3 break-all text-sm">URI: {page.metadata.uri}</p>
              <pre className="mt-4 whitespace-pre-wrap break-all text-xs">
                {page.metadata.canonicalDocument}
              </pre>
            </details>
          )}
          {page.initialReport && (
            <p className="mt-5 break-all text-sm">
              Initial inspection {page.initialReport.id} · commitment{" "}
              {page.initialReport.documentHash}
            </p>
          )}
          {page.mint.receipt && (
            <p className="mt-4 break-all text-sm">
              Mint signature: {page.mint.receipt.signature} · {page.mint.receipt.status}{" "}
              · {page.mint.receipt.indexed ? "Indexed" : "Awaiting indexing"}
            </p>
          )}
          {!page.chain?.minted && !page.published && (
            <form
              className="mt-6"
              onSubmit={(event) => {
                event.preventDefault();
                void workflow?.prepare(mintConfirmed);
              }}
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={mintConfirmed}
                  disabled={disabled || !page.canMint}
                  onChange={(event) => setMintConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the public metadata, verified initial inspection and
                  custody, and the configured collection and initial digital owner.
                </span>
              </label>
              <button
                type="submit"
                className="mt-5 min-h-12 border border-muted px-4"
                disabled={disabled || !page.canMint || !mintConfirmed}
              >
                Prepare Core mint
              </button>
            </form>
          )}
          {page.chain?.minted && !page.published && (
            <form
              className="mt-6"
              onSubmit={(event) => {
                event.preventDefault();
                void workflow?.publish(publicationConfirmed);
              }}
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={publicationConfirmed}
                  disabled={disabled || !page.canPublish}
                  onChange={(event) => setPublicationConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the finalized asset and approved public artwork
                  documentation for publication.
                </span>
              </label>
              <button
                type="submit"
                className="mt-5 min-h-12 border border-muted px-4"
                disabled={disabled || !page.canPublish || !publicationConfirmed}
              >
                Publish artwork
              </button>
            </form>
          )}
          {page.published && (
            <Link
              className="text-link mt-5 inline-block min-h-12"
              href={`/art/${page.kathaId}`}
            >
              View published artwork
            </Link>
          )}
        </div>
      )}
      {flow.operation?.kind === "MINT_ARTWORK" &&
        flow.operation.kathaId === kathaId && (
          <div className="mt-8">
            <TransactionReviewView
              state={flow}
              id="mint-transaction-review"
              title="Core mint transaction review"
              onApprove={() => void transactions?.approveAndSend()}
              onCancel={() => transactions?.cancel()}
              onCheck={() => void transactions?.checkConfirmation()}
            />
          </div>
        )}
    </section>
  );
}
