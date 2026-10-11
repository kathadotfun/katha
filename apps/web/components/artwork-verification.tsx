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
  createArtworkVerificationWorkflow,
  emptyVerificationSnapshot,
  type ArtworkVerificationWorkflow,
} from "../lib/artwork-verification";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { TransactionReviewView } from "./transaction-review";
import { OpsSignedOut, ReceiptLine, WorkflowIntro } from "./ops-ui";
import { Badge, FieldTag, Notice, type Tone } from "./ui/status";

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
      <OpsSignedOut path={`/admin/artworks/${kathaId}/verification`} role="verifier" />
    );
  const page = state.page;
  const [tone, status]: [Tone, string] = !page
    ? state.error
      ? ["err", "Unavailable"]
      : ["neu", "Checking"]
    : page.verification.finalized
      ? ["ok", "Verified"]
      : page.verification.unresolved
        ? ["warn", "Reconciling"]
        : !page.registration.finalized
          ? ["err", "Registration needed"]
          : ["neu", "Not verified"];
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <WorkflowIntro tone={tone} status={status}>
        A verification records that a Katha verifier inspected the physical work and
        checked its authorship evidence. It&apos;s a manual assessment, recorded with
        your wallet, not a guarantee. A fingerprint, NFC link or passing simulation
        doesn&apos;t perform that inspection.
      </WorkflowIntro>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking access and saved verification state…
        </p>
      )}
      {state.error && (
        <Notice tone="err" icon="warning">
          <p>
            <strong>Verification can&apos;t continue right now.</strong> {state.error}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn btn-o btn-sm"
              disabled={state.busy || !workflow}
              onClick={() => void workflow?.read()}
            >
              Check again
            </button>
            <Link className="btn btn-o btn-sm" href="/account">
              Switch wallet
            </Link>
          </div>
        </Notice>
      )}
      {page && (
        <VerificationContent
          key={`${auth.session.walletId}:${auth.session.expiresAt}:${page.updatedAt}:${page.metadata?.id}:${page.verification.finalized}:${page.verification.unresolved}`}
          page={page}
          disabled={state.busy || state.reloadRequired}
          busy={state.busy}
          workflow={workflow}
          flow={flow}
        />
      )}
      {flow.operation?.kind === "VERIFY_ARTWORK" &&
        flow.operation.kathaId === kathaId && (
          <TransactionReviewView
            id="artwork-verification-transaction"
            title="Verification transaction"
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}
    </div>
  );
}

function VerificationContent({
  page,
  disabled,
  busy,
  workflow,
  flow,
}: {
  page: NonNullable<ReturnType<ArtworkVerificationWorkflow["getSnapshot"]>["page"]>;
  disabled: boolean;
  busy: boolean;
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
  const matches = digest.trim() === page.identity?.authorshipEvidenceHash;
  return (
    <>
      {page.verification.finalized && (
        <Notice tone="ok">
          <p>
            <strong>Already verified.</strong> This work&apos;s verification is
            finalized. There&apos;s nothing more to record here.
          </p>
          <Link
            className="btn btn-o btn-sm self-start"
            href={`/admin/artworks/${page.kathaId}/condition`}
          >
            Continue to condition
          </Link>
        </Notice>
      )}
      {page.verification.unresolved && (
        <Notice tone="warn" icon="warning">
          <p>
            <strong>A verification is waiting to be reconciled.</strong> A saved
            transaction hasn&apos;t been confirmed by Katha yet. Don&apos;t send
            another; reload to check its outcome.
          </p>
        </Notice>
      )}
      <div
        className="grid items-start gap-5"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))",
        }}
      >
        <section className="panel cut" aria-labelledby="verification-identity">
          <h2 id="verification-identity" className="h3">
            Registered identity
          </h2>
          <dl className="mt-3 mb-0">
            <div className="kv kv-ops">
              <dt>Katha ID</dt>
              <dd className="id">{page.kathaId}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Artwork</dt>
              <dd>{page.title}</dd>
            </div>
            <div className="kv kv-ops">
              <dt>Registration</dt>
              <dd>
                {page.registration.finalized
                  ? "Finalized"
                  : "Finalized registration required"}
              </dd>
            </div>
            {page.identity && (
              <div className="kv kv-ops">
                <dt>Tradition, year</dt>
                <dd>
                  {artworkCategoryLabels[page.identity.category]},{" "}
                  {page.identity.creationYear}
                </dd>
              </div>
            )}
            <div className="kv kv-ops">
              <dt>Network</dt>
              <dd>{page.cluster === "devnet" ? "Solana Devnet" : "Localnet"}</dd>
            </div>
          </dl>
        </section>
        <section className="panel cut" aria-labelledby="verification-attribution">
          <h2 id="verification-attribution" className="h3">
            Artist attribution
          </h2>
          <dl className="mt-3 mb-0">
            {page.identity && (
              <>
                <div className="kv kv-ops">
                  <dt>Artist record</dt>
                  <dd className="id">{page.identity.artistId}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Creator wallet</dt>
                  <dd className="id">
                    {page.identity.creatorWallet ?? "No creator wallet recorded"}
                  </dd>
                </div>
              </>
            )}
            <div className="kv kv-ops">
              <dt>Profile</dt>
              <dd>
                <Badge tone={page.artistVerified ? "ok" : "warn"} marker={false}>
                  {page.artistVerified ? "Verified" : "Not verified"}
                </Badge>
              </dd>
            </div>
            {page.metadata && (
              <div className="kv kv-ops">
                <dt>Metadata reviewed</dt>
                <dd>
                  Version {page.metadata.version},{" "}
                  <span className="id">sha256 {page.metadata.documentHash}</span>
                </dd>
              </div>
            )}
          </dl>
          {page.metadata && (
            <details className="more mt-1">
              <summary>View full document</summary>
              <pre className="xs inset mt-2 overflow-x-auto whitespace-pre-wrap wrap-anywhere">
                {page.metadata.canonicalDocument}
              </pre>
            </details>
          )}
        </section>
      </div>

      <section className="panel cut" aria-labelledby="verification-evidence">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <h2 id="verification-evidence" className="h3">
            Authorship evidence
          </h2>
          <FieldTag kind="priv" />
        </div>
        <p className="p sm mt-2">
          Keep the evidence and inspection record in approved private storage. Compute
          the SHA-256 of the exact evidence bytes used at registration and enter only
          the fingerprint here; nothing is uploaded.
        </p>
        <div className="ev mt-2">
          <span>Registered fingerprint</span>
          <span className="id xs">
            {page.identity
              ? `sha256 ${page.identity.authorshipEvidenceHash}`
              : "Not recorded"}
          </span>
        </div>
        <div className="fld mt-3">
          <label className="lbl" htmlFor="verification-digest">
            Fingerprint of the evidence you reviewed <FieldTag kind="req" />
          </label>
          <input
            id="verification-digest"
            className="inp id font-medium"
            value={digest}
            onChange={(event) => setDigest(event.target.value)}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || !eligible || !free}
            aria-invalid={digest && !matches ? true : undefined}
            aria-describedby="evidence-match"
          />
        </div>
        <div className="ev mt-2">
          <span>Fingerprint check</span>
          <span id="evidence-match" role="status">
            {!digest ? (
              <Badge tone="neu" marker={false}>
                Enter the fingerprint you reviewed
              </Badge>
            ) : matches ? (
              <Badge tone="ok">Matches registration</Badge>
            ) : (
              <Badge tone="err">Doesn&apos;t match registration</Badge>
            )}
          </span>
        </div>
      </section>

      {receipt && (
        <ReceiptLine
          receipt={receipt}
          cluster={page.cluster}
          label="Saved verification transaction"
        />
      )}

      {!page.verification.finalized && (
        <section
          className="panel cut flex flex-col gap-3"
          aria-labelledby="verification-confirm"
        >
          <h2 id="verification-confirm" className="h3">
            Your confirmation
          </h2>
          <p className="p sm">
            Both are required before the verification transaction can be prepared.
          </p>
          <fieldset
            className="flex flex-col gap-3"
            disabled={disabled || !eligible || !free}
          >
            <legend className="sr-only">Verifier approval</legend>
            <label className="chk chk-box cut-s">
              <input
                type="checkbox"
                checked={inspected}
                onChange={(event) => setInspected(event.target.checked)}
              />
              <span>
                I inspected this physical artwork in person and it matches the
                registered record.
              </span>
            </label>
            <label className="chk chk-box cut-s">
              <input
                type="checkbox"
                checked={authorship}
                onChange={(event) => setAuthorship(event.target.checked)}
              />
              <span>
                The private authorship evidence supports attribution to this artist.
              </span>
            </label>
            <button
              className="btn btn-p cut-s mt-1.5 self-start"
              type="button"
              disabled={!inspected || !authorship || !matches}
              onClick={() => {
                const confirmed = inspected && authorship;
                const reviewed = digest.trim();
                setInspected(false);
                setAuthorship(false);
                setDigest("");
                void workflow?.prepare(confirmed, reviewed);
              }}
            >
              Prepare verification transaction
            </button>
          </fieldset>
          {!eligible && (
            <p className="p sm">
              Verification needs a verified artist, a prepared document and a finalized
              registration, with no unresolved signed attempt.
            </p>
          )}
        </section>
      )}
      <button
        type="button"
        className="lnk self-start"
        disabled={busy || !workflow}
        onClick={() => void workflow?.read()}
      >
        Reload verification state
      </button>
    </>
  );
}
