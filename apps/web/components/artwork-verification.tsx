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
  createArtworkVerificationWorkflow,
  emptyVerificationSnapshot,
  type ArtworkVerificationWorkflow,
} from "../lib/artwork-verification";
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {};
const emptyAuth = () => signedOutSnapshot;
const emptyFlow = () => idleTransactionSnapshot;
const emptyPage = () => emptyVerificationSnapshot;
export function ArtworkVerificationPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<ArtworkVerificationWorkflow | null>(null);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const current = createArtworkVerificationWorkflow(
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
        Connect and sign in with a verifier wallet in the header to review authenticity.
      </p>
    );
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="verification-controls"
      aria-busy={state.busy}
    >
      <h2 id="verification-controls" className="text-2xl">
        Manual authentication and chain attestation
      </h2>
      <p className="mt-4 text-sm text-muted">
        Inspect the physical artwork and authorship evidence before approving
        authenticity. A digest, NFC link or successful simulation does not perform that
        inspection. Condition, custody and ownership are recorded separately.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking access and saved verification state…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      <button
        type="button"
        className="text-link mt-4"
        disabled={state.busy || !workflow}
        onClick={() => void workflow?.read()}
      >
        Reload verification state
      </button>
      {state.page && (
        <VerificationContent
          key={`${auth.session.walletId}:${auth.session.expiresAt}:${state.page.updatedAt}:${state.page.metadata?.id}:${state.page.verification.finalized}:${state.page.verification.unresolved}`}
          page={state.page}
          disabled={state.busy || state.reloadRequired}
          workflow={workflow}
          flow={flow}
        />
      )}
      {flow.operation?.kind === "VERIFY_ARTWORK" &&
        flow.operation.kathaId === kathaId && (
          <TransactionReviewView
            id="artwork-verification-transaction"
            title="Artwork authenticity transaction review"
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}
    </section>
  );
}
function VerificationContent({
  page,
  disabled,
  workflow,
  flow,
}: {
  page: NonNullable<ReturnType<ArtworkVerificationWorkflow["getSnapshot"]>["page"]>;
  disabled: boolean;
  workflow: ArtworkVerificationWorkflow | null;
  flow: typeof idleTransactionSnapshot;
}) {
  const [inspected, setInspected] = useState(false),
    [authorship, setAuthorship] = useState(false),
    [digest, setDigest] = useState("");
  const eligible =
    page.identity &&
    page.artistVerified &&
    page.metadata &&
    page.registration.finalized &&
    !page.registration.unresolved &&
    !page.published &&
    !page.verification.finalized &&
    !page.verification.unresolved;
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
  const receipt = page.verification.receipt;
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
        <div>
          <dt>Registration</dt>
          <dd>
            {page.registration.finalized
              ? "Registration finalized"
              : "Finalized registration required"}
          </dd>
        </div>
        {page.identity && (
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
              <dt>Registered authorship evidence commitment</dt>
              <dd className="break-all font-mono">
                {page.identity.authorshipEvidenceHash}
              </dd>
            </div>
          </>
        )}
      </dl>
      <p role="status" className="mt-6">
        {page.verification.finalized
          ? "Artwork verification finalized."
          : page.verification.unresolved
            ? "A retained verification signature is unresolved. Check its outcome before preparing a replacement."
            : "No finalized artwork verification recorded."}
      </p>
      {receipt && (
        <div className="mt-3 text-sm">
          <p className="break-all">
            Retained verification signature: {receipt.signature}
          </p>
          <p>
            Receipt: {receipt.status}
            {receipt.slot ? ` · Slot ${receipt.slot}` : ""}
          </p>
          <p>
            {receipt.status === "FINALIZED"
              ? receipt.indexed
                ? "Verification event indexed."
                : "Finalized; verification indexing pending."
              : "A signature alone does not establish successful verification."}
          </p>
        </div>
      )}
      {page.metadata && (
        <>
          <h3 className="mt-8 text-xl">
            Reviewed public document · Version {page.metadata.version}
          </h3>
          <p className="mt-3 text-sm">
            Exact saved bytes and SHA-256 verified. The document remains public; private
            inspection records and evidence stay outside it.
          </p>
          <p className="mt-3 break-all font-mono text-sm">
            {page.metadata.documentHash}
          </p>
          <details className="mt-4">
            <summary>Review exact canonical document</summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-sm">
              {page.metadata.canonicalDocument}
            </pre>
          </details>
        </>
      )}
      <fieldset className="mt-8 space-y-4" disabled={disabled || !eligible || !free}>
        <legend className="text-xl">Verifier approval</legend>
        <p className="text-sm">
          Keep the inspection record and original authorship evidence in approved
          private storage. Compute SHA-256 from the exact evidence bytes used at
          registration; enter only the digest here. This form does not upload evidence
          or inspection notes.
        </p>
        <label className="block">
          Reviewed evidence SHA-256
          <input
            className="mt-2 block w-full min-w-0 min-h-12 border border-muted bg-surface px-3 py-2 font-mono"
            value={digest}
            onChange={(e) => setDigest(e.target.value)}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="evidence-match"
          />
        </label>
        <p id="evidence-match" className="text-sm" role="status">
          {digest && digest !== page.identity?.authorshipEvidenceHash
            ? "The reviewed evidence digest does not match the registered commitment."
            : digest
              ? "Reviewed evidence digest matches the registered commitment."
              : "Enter the digest of the evidence you reviewed."}
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={inspected}
            onChange={(e) => setInspected(e.target.checked)}
          />
          <span>
            I physically inspected this artwork and matched it to its permanent identity
            and documentation.
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={authorship}
            onChange={(e) => setAuthorship(e.target.checked)}
          />
          <span>
            I reviewed the artist attribution and private authorship evidence and
            approve this artwork’s authenticity.
          </span>
        </label>
        <button
          className="button-primary"
          type="button"
          disabled={
            !inspected ||
            !authorship ||
            digest !== page.identity?.authorshipEvidenceHash
          }
          onClick={() => {
            const confirmed = inspected && authorship;
            setInspected(false);
            setAuthorship(false);
            setDigest("");
            void workflow?.prepare(confirmed, digest);
          }}
        >
          Prepare and simulate verification
        </button>
      </fieldset>
      {!eligible && !page.verification.finalized && (
        <p className="mt-4 text-sm">
          Verification requires a verified artist, prepared metadata and finalized
          registration, with no unresolved signed attempt.
        </p>
      )}
      {page.verification.finalized && (
        <p className="mt-4 text-sm">
          This records the verifier’s authenticity attestation. Publication and minting
          require the later inspection and custody steps.
        </p>
      )}
    </>
  );
}
