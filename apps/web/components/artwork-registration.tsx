"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import {
  createArtworkRegistrationWorkflow,
  emptyRegistrationSnapshot,
  type ArtworkRegistrationWorkflow,
} from "../lib/artwork-registration";
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {};
const emptyAuth = () => signedOutSnapshot;
const emptyFlow = () => idleTransactionSnapshot;
const emptyPage = () => emptyRegistrationSnapshot;
export function ArtworkRegistrationPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<ArtworkRegistrationWorkflow | null>(null);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const current = createArtworkRegistrationWorkflow(
      session,
      connection,
      transactions,
      kathaId,
    );
    setWorkflow(current);
    return () => current.dispose();
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
        Connect and sign in with an administrator wallet in the header to register this
        artwork.
      </p>
    );
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="registration-controls"
      aria-busy={state.busy}
    >
      <h2 id="registration-controls" className="text-2xl">
        Permanent identity and document review
      </h2>
      <p className="mt-4 text-sm text-muted">
        Registration preserves authorship and the evidence commitment. It does not
        authenticate, mint, publish or move the physical artwork. Metadata is reviewed
        and retained with this operation; its on-chain commitment is a later action.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking access and saved registration state…
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
        Reload registration state
      </button>
      {state.page && (
        <RegistrationContent
          key={`${auth.session.walletId}:${auth.session.expiresAt}:${state.page.updatedAt}:${state.page.metadata?.id}`}
          page={state.page}
          disabled={state.busy || state.reloadRequired}
          workflow={workflow}
          flow={flow}
        />
      )}
      {flow.operation?.kind === "REGISTER_ARTWORK" &&
        flow.operation.kathaId === kathaId && (
          <TransactionReviewView
            id="artwork-registration-transaction"
            title="Artwork registration transaction review"
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}
    </section>
  );
}
function RegistrationContent({
  page,
  disabled,
  workflow,
  flow,
}: {
  page: NonNullable<ReturnType<ArtworkRegistrationWorkflow["getSnapshot"]>["page"]>;
  disabled: boolean;
  workflow: ArtworkRegistrationWorkflow | null;
  flow: ReturnType<
    NonNullable<ReturnType<typeof useTransactionLifecycle>>["getSnapshot"]
  >;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const eligible =
    page.identity &&
    page.artistVerified &&
    !page.published &&
    !page.registration.finalized &&
    !page.registration.unresolved;
  const free =
    ["idle", "not-completed", "failed", "expired"].includes(flow.phase) &&
    (!flow.signature || flow.phase === "failed");
  const receipt = page.registration.receipt;
  return (
    <>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt>Permanent Katha ID</dt>
          <dd>{page.kathaId}</dd>
        </div>
        <div>
          <dt>Artwork</dt>
          <dd>{page.title}</dd>
        </div>
        <div>
          <dt>Network</dt>
          <dd>
            {page.cluster === "devnet" ? "Devnet" : "Localnet"} · Test environment
          </dd>
        </div>
        <div>
          <dt>Artist profile</dt>
          <dd>
            {page.artistVerified ? "Manually verified" : "Artist verification required"}
          </dd>
        </div>
        {page.identity ? (
          <>
            <div>
              <dt>Immutable artist ID</dt>
              <dd className="break-all">{page.identity.artistId}</dd>
            </div>
            <div>
              <dt>Creator wallet</dt>
              <dd className="break-all">
                {page.identity.creatorWallet ?? "No creator wallet recorded"}
              </dd>
            </div>
            <div>
              <dt>Category and creation year</dt>
              <dd>
                {page.identity.category} · {page.identity.creationYear}
              </dd>
            </div>
            <div>
              <dt>Authorship evidence commitment</dt>
              <dd className="break-all font-mono">
                {page.identity.authorshipEvidenceHash}
              </dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Authorship commitment</dt>
            <dd>
              Add a nonzero evidence digest in artwork documentation before proceeding.
            </dd>
          </div>
        )}
      </dl>
      <p role="status" className="mt-6">
        {page.registration.finalized
          ? "Registration finalized."
          : page.registration.unresolved
            ? "A retained signature is unresolved. Check its outcome before preparing a replacement."
            : "No finalized registration receipt recorded."}
      </p>
      {receipt && (
        <div className="mt-3 text-sm">
          <p className="break-all">Retained signature: {receipt.signature}</p>
          <p>
            Receipt: {receipt.status}
            {receipt.slot ? ` · Slot ${receipt.slot}` : ""}
          </p>
          <p>
            {receipt.status === "FINALIZED"
              ? receipt.indexed
                ? "Registration event indexed."
                : "Finalized; registration indexing pending."
              : "A signature alone does not establish a successful registration."}
          </p>
        </div>
      )}
      {page.metadata ? (
        <>
          <h3 className="mt-8 text-xl">
            Canonical public metadata · Version {page.metadata.version}
          </h3>
          <p className="mt-3 text-sm">
            Exact saved bytes and SHA-256 verified. Review every public field before
            preparing the transaction. Saving this document closes draft and media
            editing.
          </p>
          <p className="mt-3 break-all font-mono text-sm">
            {page.metadata.documentHash}
          </p>
          <p className="mt-3 break-all text-sm">Document URI: {page.metadata.uri}</p>
          <details className="mt-4">
            <summary>Review exact canonical document</summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-sm">
              {page.metadata.canonicalDocument}
            </pre>
          </details>
          <fieldset
            disabled={
              disabled || !eligible || !free || page.metadata.status !== "PREPARED"
            }
            className="mt-6"
          >
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I reviewed the permanent identity, artist attribution, authorship
                commitment and exact public metadata.
              </span>
            </label>
            <button
              type="button"
              className="button-primary mt-4"
              disabled={!confirmed}
              onClick={() => {
                setConfirmed(false);
                void workflow?.prepare(confirmed);
              }}
            >
              Prepare and simulate registration
            </button>
          </fieldset>
        </>
      ) : (
        <>
          <h3 className="mt-8 text-xl">Prepare the public document</h3>
          <p className="mt-3 text-sm">
            First verify the artist and finish documentation and approved media,
            including one public hero image. Preparing canonical metadata publishes its
            exact JSON bytes and closes draft and media editing. Keep personal
            information and private evidence outside the public document.
          </p>
          <button
            type="button"
            className="button-primary mt-4"
            disabled={disabled || !eligible || !free}
            onClick={() => void workflow?.prepareMetadata()}
          >
            Prepare canonical metadata
          </button>
        </>
      )}
      {page.published && (
        <p className="mt-4">
          This artwork is already published; initial registration is unavailable.
        </p>
      )}
    </>
  );
}
