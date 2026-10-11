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
  createArtworkRegistrationWorkflow,
  emptyRegistrationSnapshot,
  type ArtworkRegistrationWorkflow,
} from "../lib/artwork-registration";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { TransactionReviewView } from "./transaction-review";
import { Check, OpsSignedOut, ReceiptLine, WorkflowIntro } from "./ops-ui";
import { Badge, FieldTag, Notice, type Tone } from "./ui/status";

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
      <OpsSignedOut
        path={`/admin/artworks/${kathaId}/registration`}
        role="administrator"
      />
    );
  const page = state.page;
  const tx =
    flow.operation?.kind === "REGISTER_ARTWORK" && flow.operation.kathaId === kathaId;
  const [tone, status]: [Tone, string] = !page
    ? ["neu", state.busy ? "Checking" : "Not loaded"]
    : page.registration.finalized
      ? page.registration.receipt?.indexed === false
        ? ["warn", "Indexing"]
        : ["ok", "Registered"]
      : page.registration.unresolved
        ? ["warn", "Outcome unknown"]
        : !page.identity || !page.artistVerified
          ? ["err", "Blocked"]
          : page.metadata
            ? ["info", "Ready to simulate"]
            : ["neu", "Not registered"];
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <WorkflowIntro tone={tone} status={status}>
        Registration writes this artwork&apos;s permanent identity and a fingerprint of
        its metadata document to Katha&apos;s registry on Solana. Review everything
        exactly as it will be recorded. It doesn&apos;t authenticate, mint, publish or
        move the work.
      </WorkflowIntro>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking access and saved registration state…
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
              Reload registration state
            </button>
          )}
        </Notice>
      )}
      {page && (
        <RegistrationContent
          key={`${auth.session.walletId}:${auth.session.expiresAt}:${page.updatedAt}:${page.metadata?.id}`}
          page={page}
          disabled={state.busy || state.reloadRequired}
          workflow={workflow}
          flow={flow}
          busy={state.busy}
        />
      )}
      {tx && (
        <TransactionReviewView
          id="artwork-registration-transaction"
          title="Registration transaction"
          state={flow}
          onApprove={() => void transactions?.approveAndSend()}
          onCheck={() => void transactions?.checkConfirmation()}
          onCancel={() => transactions?.cancel()}
        />
      )}
    </div>
  );
}

function RegistrationContent({
  page,
  disabled,
  busy,
  workflow,
  flow,
}: {
  page: NonNullable<ReturnType<ArtworkRegistrationWorkflow["getSnapshot"]>["page"]>;
  disabled: boolean;
  busy: boolean;
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
    <div className="flex flex-wrap items-start gap-8">
      <div className="flex min-w-0 flex-col gap-6" style={{ flex: "999 1 620px" }}>
        <section className="panel cut" aria-labelledby="registration-prereq">
          <h2 id="registration-prereq" className="h3">
            Before registering
          </h2>
          <ul className="chk-list mt-2.5">
            <Check
              ok={Boolean(page.identity)}
              title="Authorship evidence fingerprint"
              detail={
                page.identity
                  ? "Recorded in the documentation"
                  : "Add the evidence fingerprint in the documentation first."
              }
              fix={{ href: `/admin/artworks/${page.kathaId}` }}
            />
            <Check
              ok={page.artistVerified}
              title="Artist profile verified"
              detail={page.artistVerified ? "Manually verified" : "Not verified yet"}
              fix={{ href: "/admin", label: "Go to Administration" }}
            />
            <Check
              ok={Boolean(page.metadata)}
              pending={!page.metadata}
              title="Metadata document prepared"
              detail={
                page.metadata
                  ? `Version ${page.metadata.version}, ${page.metadata.status === "FINALIZED" ? "committed" : "prepared"}`
                  : "Built from saved documentation and approved media, including one public hero image."
              }
            />
            <Check
              ok={!page.published}
              title="Not yet published"
              detail={
                page.published
                  ? "Already published; initial registration is unavailable."
                  : "Unpublished record"
              }
            />
          </ul>
          {!page.artistVerified && (
            <Notice tone="err" className="mt-3">
              <p>
                <strong>Registration is blocked.</strong> The artist&apos;s profile
                isn&apos;t verified yet. A verifier can record it in Administration.{" "}
                <Link className="lnk" href="/admin">
                  Go to Administration
                </Link>
              </p>
            </Notice>
          )}
        </section>

        <section className="panel cut" aria-labelledby="registration-identity">
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <h2 id="registration-identity" className="h3">
              Identity to be recorded
            </h2>
            <FieldTag kind="lock">Permanent</FieldTag>
          </div>
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
              <dt>Network</dt>
              <dd>
                {page.cluster === "devnet" ? "Solana Devnet" : "Localnet"}, test
                environment
              </dd>
            </div>
            {page.identity ? (
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
                <div className="kv kv-ops">
                  <dt>Tradition, year</dt>
                  <dd>
                    {artworkCategoryLabels[page.identity.category]},{" "}
                    {page.identity.creationYear}
                  </dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Authorship evidence</dt>
                  <dd className="id">sha256 {page.identity.authorshipEvidenceHash}</dd>
                </div>
              </>
            ) : (
              <div className="kv kv-ops">
                <dt>Authorship evidence</dt>
                <dd>
                  Add a nonzero evidence fingerprint in the documentation before
                  proceeding.
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="panel cut" aria-labelledby="registration-document">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 id="registration-document" className="h3">
              Metadata document
            </h2>
            {page.metadata && (
              <Badge tone="ok" marker={false}>
                {page.metadata.status === "FINALIZED" ? "Committed" : "Prepared"}
              </Badge>
            )}
          </div>
          {page.metadata ? (
            <>
              <dl className="mt-3 mb-0">
                <div className="kv kv-ops">
                  <dt>Version</dt>
                  <dd>{page.metadata.version}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Fingerprint</dt>
                  <dd className="id">sha256 {page.metadata.documentHash}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Document</dt>
                  <dd className="id">{page.metadata.uri}</dd>
                </div>
              </dl>
              <p className="help mt-2.5">
                Exact saved bytes and fingerprint verified in this browser. Saving the
                document closed draft and media editing.
              </p>
              <details className="more mt-1">
                <summary>View full document</summary>
                <pre className="xs inset mt-2 overflow-x-auto whitespace-pre-wrap wrap-anywhere">
                  {page.metadata.canonicalDocument}
                </pre>
              </details>
            </>
          ) : (
            <>
              <p className="p sm mt-2.5">
                Katha builds a document from the saved documentation and approved media,
                then fingerprints it. The fingerprint is what goes on chain. Preparing
                publishes the exact document bytes and closes draft and media editing,
                so keep personal information and private evidence out of it.
              </p>
              <button
                type="button"
                className="btn btn-p cut-s mt-3.5"
                disabled={disabled || !eligible || !free}
                onClick={() => void workflow?.prepareMetadata()}
              >
                {busy ? "Preparing…" : "Prepare document"}
              </button>
            </>
          )}
        </section>

        {receipt && (
          <ReceiptLine
            receipt={receipt}
            cluster={page.cluster}
            label="Saved registration transaction"
          />
        )}

        {page.metadata && !page.registration.finalized && (
          <section
            className="panel cut flex flex-col gap-3"
            aria-labelledby="registration-confirm"
          >
            <h2 id="registration-confirm" className="h3">
              Your confirmation
            </h2>
            <fieldset
              className="flex flex-col gap-3"
              disabled={
                disabled || !eligible || !free || page.metadata.status !== "PREPARED"
              }
            >
              <label className="chk chk-box">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  I reviewed the permanent identity, artist attribution, authorship
                  fingerprint and the exact public metadata.
                </span>
              </label>
              <button
                type="button"
                className="btn btn-p cut-s self-start"
                disabled={!confirmed}
                onClick={() => {
                  setConfirmed(false);
                  void workflow?.prepare(confirmed);
                }}
              >
                Prepare and simulate registration
              </button>
            </fieldset>
            {page.registration.unresolved && (
              <p className="p sm">
                A saved signature is unresolved. Reload to check its outcome before
                preparing a replacement.
              </p>
            )}
          </section>
        )}

        {page.registration.finalized && (
          <div className="flex flex-wrap gap-3">
            <Link
              className="btn btn-p cut-s"
              href={`/admin/artworks/${page.kathaId}/verification`}
            >
              Continue to verification
            </Link>
          </div>
        )}
        <button
          className="lnk self-start"
          type="button"
          disabled={busy || !workflow}
          onClick={() => void workflow?.read()}
        >
          Reload registration state
        </button>
      </div>
      <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
        <div className="panel cut-s flex flex-col gap-2">
          <h2 className="h3">What goes on chain</h2>
          <p className="p sm">
            The Katha ID, artist record, creator wallet, tradition, year, the authorship
            evidence fingerprint and the metadata document fingerprint. Photos and text
            stay off chain.
          </p>
          <Link className="lnk sm" href={`/admin/artworks/${page.kathaId}/media`}>
            Manage media
          </Link>
        </div>
      </aside>
    </div>
  );
}
