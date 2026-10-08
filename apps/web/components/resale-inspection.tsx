"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { createResaleWorkflow, emptyResaleSnapshot } from "../lib/resale-inspection";
const noop = () => () => {};
function dateLabel(seconds: string) {
  const date = new Date(Number(seconds) * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : `${seconds} seconds`;
}
export function ResaleInspectionPanel({
  kathaId,
  verifier = false,
}: {
  kathaId: string;
  verifier?: boolean;
}) {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? (() => signedOutSnapshot),
    () => signedOutSnapshot,
  );
  const [workflow, setWorkflow] = useState<ReturnType<
    typeof createResaleWorkflow
  > | null>(null);
  useEffect(() => {
    if (!session) return;
    const value = createResaleWorkflow(session, kathaId, verifier);
    setWorkflow(value);
    return () => value.dispose();
  }, [session, kathaId, verifier]);
  const state = useSyncExternalStore(
    workflow?.subscribe ?? noop,
    workflow?.getSnapshot ?? (() => emptyResaleSnapshot),
    () => emptyResaleSnapshot,
  );
  if (!auth.session)
    return (
      <p className="mt-8" role="status">
        Sign in with the {verifier ? "authorized verifier" : "current owner"} wallet to
        review inspection coordination.
      </p>
    );
  const page = state.page;
  return (
    <section
      className="mt-10 max-w-reading"
      aria-labelledby="resale-inspection-title"
      aria-busy={state.busy}
    >
      <h2 id="resale-inspection-title" className="text-2xl">
        {verifier ? "Collector resale requests" : "Inspection and resale"}
      </h2>
      <p className="mt-4 text-muted">
        Katha inspects the physical Nepali artwork in person. A request does not verify
        condition or approve a sale. Approval comes from a finalized verifier-signed
        condition report matching the current owner and custody revision.
      </p>
      <button
        className="button-primary mt-5"
        disabled={!workflow || state.busy}
        onClick={() => void workflow?.read()}
      >
        Refresh inspection status
      </button>
      {state.busy && (
        <p className="mt-4" role="status">
          Checking requests and finalized approval…
        </p>
      )}
      {state.error && (
        <p className="mt-4" role="alert">
          {state.error}
        </p>
      )}
      {page && (
        <>
          <p className="text-lead mt-6">{page.title}</p>
          <p className="mt-3">
            {page.custodyState === "COLLECTOR_HELD"
              ? "Collector-held"
              : "In Katha custody"}{" "}
            · Custody revision {page.custodyRevision}
          </p>
          <p className="mt-3 break-all text-sm">Current owner: {page.ownerWallet}</p>
          <p className="mt-5" role="status">
            Inspection approval: {page.inspection.status.toLowerCase()}.
          </p>
          <p className="mt-3 text-sm">Observed at {dateLabel(page.chainTime)}.</p>
          {page.inspection.validUntil &&
            ["APPROVED", "EXPIRED"].includes(page.inspection.status) && (
              <p className="mt-3 text-sm">
                Approval validity ends at {dateLabel(page.inspection.validUntil)}.
              </p>
            )}
          {!page.secondary && (
            <p className="mt-3 text-sm">
              Primary sale rules apply. Collector resale requests become available after
              the first sale.
            </p>
          )}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-link">
              Inspect recorded approval
            </summary>
            <p className="mt-3">
              Condition version {page.inspection.version} · Inspected{" "}
              {dateLabel(page.inspection.inspectedAt)}.
            </p>
            <p className="mt-3 break-all">Report: {page.inspection.report}</p>
            <p className="mt-3 break-all">Report commitment: {page.inspection.hash}</p>
          </details>
          {page.canList ? (
            <p className="mt-5">
              The observed inspection requirements are met. Listing and purchase still
              recheck ownership, custody and approval age.{" "}
              {!verifier && (
                <Link className="text-link" href={`/collection/${kathaId}/list`}>
                  Review a listing
                </Link>
              )}
            </p>
          ) : (
            <p className="mt-5">
              Resale remains unavailable while approval is missing, stale, expired or an
              active listing needs release.
            </p>
          )}
          {!verifier && page.canRequest && (
            <button
              className="button-primary mt-5"
              disabled={state.busy}
              onClick={() => void workflow?.request()}
            >
              Request Katha resale inspection
            </button>
          )}
          <h3 className="mt-8 text-xl">
            {verifier ? "Saved inspection requests" : "Your inspection requests"}
          </h3>
          {!page.requests.length && (
            <p className="mt-3">No saved requests for this view.</p>
          )}
          <ul className="mt-4 space-y-4">
            {page.requests.map((r) => (
              <li key={r.id} className="border-t border-line pt-4 break-words">
                <p>Requested {r.requestedAt}</p>
                <p className="mt-2 text-sm">
                  Owner {r.ownerWallet} · Custody revision {r.custodyRevision}
                </p>
                <p className="mt-2">
                  {r.ownerWallet !== page.ownerWallet ||
                  r.custodyRevision !== page.custodyRevision
                    ? "Request scope changed; this request cannot approve the current owner/custody."
                    : page.inspection.status === "APPROVED"
                      ? "Matching finalized inspection approval observed."
                      : "Manual inspection or renewed approval is required."}
                </p>
              </li>
            ))}
          </ul>
          {verifier && (
            <p className="mt-6">
              Use the physical inspection form below with reason PRE_RESALE for a
              secondary sale, inspect the artwork and document evidence. Review the
              owner/custody scope before signing. Refresh this status after
              finalization. Collectors cannot self-approve.
            </p>
          )}
        </>
      )}
    </section>
  );
}
