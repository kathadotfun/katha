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
import { Check, OpsSignedOut, ReceiptLine, WorkflowIntro } from "./ops-ui";
import { Notice, type Tone } from "./ui/status";

const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyMintSnapshot;
const custodyText: Record<string, string> = {
  UNKNOWN: "Not recorded",
  KATHA_HELD: "Held by Katha",
  COLLECTOR_HELD: "With a collector",
  IN_TRANSIT: "In transit",
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
    [publishing, setPublishing] = useState(false),
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
    setPublishing(false);
  }, [state.page, auth.session]);
  if (!auth.session)
    return (
      <OpsSignedOut path={`/admin/artworks/${kathaId}/minting`} role="administrator" />
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
  const blocked = new Set(page?.blockedReasons ?? []);
  const minted = Boolean(page?.chain?.minted);
  const [tone, status]: [Tone, string] = !page
    ? state.error
      ? ["err", "Unavailable"]
      : ["neu", "Checking"]
    : page.published
      ? ["ok", "Published"]
      : blocked.has("UNRESOLVED_MINT")
        ? ["warn", "Binding unresolved"]
        : blocked.has("INDEXING_PENDING")
          ? ["warn", "Indexing pending"]
          : minted
            ? ["info", "Minted, not published"]
            : page.canMint
              ? ["neu", "Ready to mint"]
              : ["err", "Blocked"];
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <WorkflowIntro tone={tone} status={status}>
        Minting creates the artwork&apos;s unique digital asset and binds it to the
        record. Publishing is a separate, explicit step that makes the work visible to
        the public.
      </WorkflowIntro>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking saved artwork and finalized chain state…
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
      {page && minted && !page.published && page.chain && (
        <Notice tone="info">
          <p>
            <strong>This artwork is already minted.</strong> Its asset{" "}
            <span className="id">{page.chain.asset}</span> is bound to {page.kathaId}.
            Each artwork has exactly one asset, so there&apos;s nothing more to mint.
          </p>
        </Notice>
      )}
      {page && (
        <div className="workflow-layout">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="panel cut" aria-labelledby="mint-prereq">
              <h2 id="mint-prereq" className="h3">
                Before minting
              </h2>
              <ul className="chk-list mt-2.5" aria-live="polite">
                <Check
                  ok={!blocked.has("ARTIST_UNVERIFIED")}
                  title="Artist profile verified"
                  detail={
                    blocked.has("ARTIST_UNVERIFIED")
                      ? "The artist profile must be verified."
                      : "Verified"
                  }
                  fix={{ href: "/admin" }}
                />
                <Check
                  ok={!blocked.has("DOCUMENTS_MISSING")}
                  title="Metadata and initial inspection report"
                  detail={
                    blocked.has("DOCUMENTS_MISSING")
                      ? "Prepare the public metadata and an initial condition report."
                      : `Metadata version ${page.chain?.metadataVersion ?? page.metadata?.version ?? "?"}, condition version ${page.chain?.conditionVersion ?? "?"}`
                  }
                  fix={{ href: `/admin/artworks/${kathaId}/condition` }}
                />
                <Check
                  ok={!blocked.has("CHAIN_PREREQUISITES")}
                  title="Registration, verification, metadata, inspection and custody on chain"
                  detail={
                    blocked.has("CHAIN_PREREQUISITES")
                      ? "Finalize registration, verification, the on-chain metadata commit (Metadata tab), the initial inspection and attested held custody (Katha or a collector) first."
                      : `Custody: ${custodyText[page.chain?.custodyState ?? "UNKNOWN"]}, revision ${page.chain?.custodyRevision ?? "?"}`
                  }
                  fix={{ href: `/admin/artworks/${kathaId}/custody` }}
                />
                <Check
                  ok={!blocked.has("AUTHORITY_REQUIRED")}
                  title="Your wallet can mint"
                  detail={
                    blocked.has("AUTHORITY_REQUIRED")
                      ? "Connect the configured registration authority to mint."
                      : "Registration authority connected"
                  }
                  fix={{ href: "/account", label: "Switch wallet" }}
                />
                <Check
                  ok={
                    !blocked.has("UNRESOLVED_MINT") && !blocked.has("OTHER_RESERVATION")
                  }
                  title="No unresolved mint"
                  detail={
                    blocked.has("UNRESOLVED_MINT")
                      ? "Reconcile the saved mint transaction before continuing; don't mint again."
                      : blocked.has("OTHER_RESERVATION")
                        ? "A mint preparation belongs to another wallet. Reconcile it first."
                        : "Nothing waiting"
                  }
                />
                <Check
                  ok={!blocked.has("INDEXING_PENDING")}
                  pending={blocked.has("INDEXING_PENDING")}
                  title="Indexed by Katha"
                  detail={
                    blocked.has("INDEXING_PENDING")
                      ? "Waiting for finalized records to be indexed. This usually takes a few minutes."
                      : "Up to date"
                  }
                />
              </ul>
            </section>

            <section className="panel cut panel-lg" aria-labelledby="mint-controls">
              <h2 id="mint-controls" className="h2 h2-ops">
                Mint the artwork asset
              </h2>
              <dl className="mt-3.5 mb-0">
                <div className="kv kv-ops">
                  <dt>Asset name</dt>
                  <dd>{page.title}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Bound to</dt>
                  <dd>
                    <span className="id">{page.kathaId}</span> in Katha&apos;s registry.
                    One asset per artwork.
                  </dd>
                </div>
                {page.chain && (
                  <>
                    <div className="kv kv-ops">
                      <dt>Asset address</dt>
                      <dd className="id">{page.chain.asset}</dd>
                    </div>
                    <div className="kv kv-ops">
                      <dt>Collection</dt>
                      <dd className="id">{page.chain.collection}</dd>
                    </div>
                    <div className="kv kv-ops">
                      <dt>First owner</dt>
                      <dd className="id">
                        {page.chain.registrationAuthority}, until the primary sale
                      </dd>
                    </div>
                    <div className="kv kv-ops">
                      <dt>Current owner</dt>
                      <dd className="id">
                        {page.chain.owner ?? "Created when minted"}
                      </dd>
                    </div>
                  </>
                )}
                {page.metadata && (
                  <div className="kv kv-ops">
                    <dt>Metadata</dt>
                    <dd>
                      Version {page.metadata.version},{" "}
                      <span className="id">sha256 {page.metadata.documentHash}</span>
                    </dd>
                  </div>
                )}
                {page.initialReport && (
                  <div className="kv kv-ops">
                    <dt>Initial inspection</dt>
                    <dd className="id">sha256 {page.initialReport.documentHash}</dd>
                  </div>
                )}
              </dl>
              {page.metadata && (
                <details className="more mt-2">
                  <summary>View full public metadata</summary>
                  <pre className="xs inset mt-2 overflow-x-auto whitespace-pre-wrap wrap-anywhere">
                    {page.metadata.canonicalDocument}
                  </pre>
                </details>
              )}
              {page.mint.receipt && (
                <div className="mt-4">
                  <ReceiptLine
                    receipt={page.mint.receipt}
                    cluster={page.cluster}
                    label="Saved mint transaction"
                  />
                </div>
              )}
              {!minted && !page.published && (
                <form
                  className="mt-4 flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void workflow?.prepare(mintConfirmed);
                  }}
                >
                  <label className="chk chk-box">
                    <input
                      type="checkbox"
                      checked={mintConfirmed}
                      disabled={disabled || !page.canMint}
                      onChange={(event) => setMintConfirmed(event.target.checked)}
                    />
                    <span>
                      I reviewed the public metadata, the initial inspection and
                      custody, and the collection and first owner.
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="btn btn-p cut-s self-start"
                    disabled={disabled || !page.canMint || !mintConfirmed}
                  >
                    Review and approve mint
                  </button>
                </form>
              )}
              <button
                type="button"
                className="lnk mt-2"
                disabled={state.busy}
                onClick={() => void workflow?.read()}
              >
                Reload saved state
              </button>
            </section>

            {flow.operation?.kind === "MINT_ARTWORK" &&
              flow.operation.kathaId === kathaId && (
                <TransactionReviewView
                  state={flow}
                  id="mint-transaction-review"
                  title="Mint transaction"
                  onApprove={() => void transactions?.approveAndSend()}
                  onCancel={() => transactions?.cancel()}
                  onCheck={() => void transactions?.checkConfirmation()}
                />
              )}

            <section
              className={`cut flex flex-col gap-3 ${page.published ? "ok-panel" : minted ? "red-panel dk" : "panel-t"}`}
              aria-labelledby="publication-title"
              style={{ padding: "clamp(20px, 3vw, 36px)" }}
            >
              <h2
                id="publication-title"
                className="serif m-0 font-semibold"
                style={{ fontSize: "clamp(22px, 2vw, 28px)" }}
              >
                Publication
              </h2>
              <p className="m-0 max-w-160">
                {page.published
                  ? "Published. The artwork is live on its public record and in Explore."
                  : minted
                    ? page.canPublish
                      ? "Minting and binding are confirmed. Publish when the record and media are ready for the public."
                      : "Minted. Publication opens once the binding is reconciled and indexing has caught up."
                    : "Available after the asset is minted, bound and indexed."}
              </p>
              {minted &&
                !page.published &&
                page.canPublish &&
                (publishing ? (
                  <div
                    className="bg-[rgba(243,232,216,0.12)] p-4"
                    role="alertdialog"
                    aria-labelledby="publish-confirm-title"
                  >
                    <form
                      className="flex flex-col gap-2.5"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void workflow?.publish(publicationConfirmed);
                      }}
                    >
                      <p id="publish-confirm-title" className="m-0 font-semibold">
                        Publish {page.title}?
                      </p>
                      <p className="m-0">
                        The record, approved media and story become visible at its
                        public page and in Explore.
                      </p>
                      <label className="chk">
                        <input
                          type="checkbox"
                          checked={publicationConfirmed}
                          disabled={disabled}
                          onChange={(event) =>
                            setPublicationConfirmed(event.target.checked)
                          }
                        />
                        <span>
                          I reviewed the finalized asset and the approved public
                          documentation.
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                        <button
                          type="submit"
                          className="btn btn-l cut-s"
                          disabled={disabled || !publicationConfirmed}
                        >
                          Publish artwork
                        </button>
                        <button
                          type="button"
                          className="lnk-d"
                          onClick={() => setPublishing(false)}
                        >
                          Not yet
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-l cut-s self-start"
                    disabled={disabled}
                    onClick={() => setPublishing(true)}
                  >
                    Publish artwork
                  </button>
                ))}
              {page.published && (
                <Link
                  className="btn btn-ok cut-s self-start"
                  href={`/art/${page.kathaId}`}
                >
                  View public record
                </Link>
              )}
            </section>
          </div>
          <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
            <div className="panel cut-s flex flex-col gap-2">
              <h2 className="h3">Minting isn&apos;t publishing</h2>
              <p className="p sm">
                Minting creates the unique digital asset and binds it to the record.
                Publishing is a separate step that makes the work visible to the public.
              </p>
            </div>
            <div className="panel cut-s flex flex-col gap-2">
              <h2 className="h3">Binding</h2>
              <p className="p sm">
                After minting, Katha checks that the registry and the new asset point to
                each other. If they don&apos;t match, the work can&apos;t be published
                until it&apos;s reconciled.
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
