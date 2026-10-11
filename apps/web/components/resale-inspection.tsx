"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { ResaleInspectionReview } from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { createResaleWorkflow, emptyResaleSnapshot } from "../lib/resale-inspection";
import { localDate, localDateTime, shortAddress, unixSecondsIso } from "../lib/format";
import { signInHref } from "../lib/return-path";
import { Badge, Notice, type Tone } from "./ui/status";

const noop = () => () => {};
function when(seconds: string, date = false) {
  try {
    const iso = unixSecondsIso(seconds);
    return date ? localDate(iso) : localDateTime(iso);
  } catch {
    return `${seconds} Unix seconds`;
  }
}
const approvalText: Record<ResaleInspectionReview["inspection"]["status"], string> = {
  NOT_REQUIRED: "Not required",
  APPROVED: "Approved",
  REQUIRED: "Required, none on record",
  EXPIRED: "Expired",
  STALE: "No longer applies",
};

function inScope(
  page: ResaleInspectionReview,
  request: ResaleInspectionReview["requests"][number],
) {
  return (
    request.ownerWallet === page.ownerWallet &&
    request.custodyRevision === page.custodyRevision
  );
}

function summary(page: ResaleInspectionReview, kathaId: string) {
  const requested = page.requests.some((request) => inScope(page, request));
  const list = page.canList
    ? { label: "Continue to listing", href: `/collection/${kathaId}/list` }
    : null;
  switch (page.inspection.status) {
    case "NOT_REQUIRED":
      return {
        tone: "ok" as Tone,
        badge: "Not required",
        title: "No inspection needed",
        body: "Katha holds this painting, so its recorded condition still applies. You can list it right away; preparation rechecks eligibility.",
        list,
      };
    case "APPROVED":
      return {
        tone: "ok" as Tone,
        badge: "Approved for resale",
        title: page.inspection.validUntil
          ? `Approved until ${when(page.inspection.validUntil)}`
          : "Approved for resale",
        body: `The inspection on ${when(page.inspection.inspectedAt, true)} approved this work for resale. List it before the approval ends, while you remain the owner and keep custody unchanged.`,
        list,
      };
    case "EXPIRED":
      return {
        tone: "err" as Tone,
        badge: "Approval expired",
        title: "Your resale approval has expired",
        body: `It ended ${page.inspection.validUntil ? when(page.inspection.validUntil) : "before a listing was created"}. Request a new inspection to list the work.`,
        list: null,
      };
    case "STALE":
      return {
        tone: "err" as Tone,
        badge: "No longer applies",
        title: "This approval no longer applies",
        body: "Ownership or custody changed after the inspection. A new inspection is needed for the painting's current situation.",
        list: null,
      };
    case "REQUIRED":
      return requested
        ? {
            tone: "info" as Tone,
            badge: "Requested",
            title: "Inspection requested",
            body: "Katha will contact you to arrange the inspection in person. You can list the work once the inspection is approved.",
            list: null,
          }
        : {
            tone: "warn" as Tone,
            badge: "Inspection needed",
            title: "Katha needs to inspect this painting before you can list it",
            body:
              page.custodyState === "COLLECTOR_HELD"
                ? "You hold the painting yourself. Request an inspection and Katha will contact you to arrange it in person."
                : "A current inspection is needed before this work can be listed.",
            list: null,
          };
  }
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
  useEffect(() => {
    if (auth.status === "signed-in") void workflow?.read();
  }, [workflow, auth.status, auth.session]);
  const state = useSyncExternalStore(
    workflow?.subscribe ?? noop,
    workflow?.getSnapshot ?? (() => emptyResaleSnapshot),
    () => emptyResaleSnapshot,
  );
  if (verifier)
    return (
      <VerifierRequests
        state={state}
        onRefresh={() => void workflow?.read()}
        signedIn={Boolean(auth.session)}
      />
    );
  if (!auth.session)
    return (
      <div className="panel cut panel-empty mt-8">
        <p className="empty-title">Sign in to check resale inspection</p>
        <p className="p max-w-xl">
          Inspection requests are tied to the current owner. Connect your wallet and
          sign in to continue.
        </p>
        <Link
          className="btn btn-p cut-s mt-2"
          href={signInHref(`/collection/${kathaId}/resale`)}
        >
          Sign in
        </Link>
      </div>
    );
  const page = state.page;
  const view = page ? summary(page, kathaId) : null;
  return (
    <div className="mt-8 flex flex-wrap items-start gap-8">
      <div
        className="flex min-w-0 flex-col gap-6"
        style={{ flex: "999 1 600px" }}
        aria-busy={state.busy}
      >
        {state.error && (
          <Notice tone="err">
            <p>{state.error}</p>
            {!page && (
              <button
                type="button"
                className="btn btn-o btn-sm self-start"
                onClick={() => void workflow?.read()}
              >
                Refresh inspection status
              </button>
            )}
          </Notice>
        )}
        {state.busy && !page && (
          <p role="status" className="p">
            Checking requests and finalized approval…
          </p>
        )}
        {page && view && (
          <>
            <section
              className="red-panel cut dk"
              aria-labelledby="resale-inspection-title"
            >
              <Badge tone={view.tone} className="self-start" role="status">
                {view.badge}
              </Badge>
              <h2
                id="resale-inspection-title"
                className="serif m-0 font-semibold"
                style={{ fontSize: "clamp(26px, 2.8vw, 36px)", lineHeight: 1.12 }}
              >
                {view.title}
              </h2>
              <p className="m-0 max-w-[40rem]">{view.body}</p>
              {!page.secondary && (
                <p className="m-0 max-w-[40rem]">
                  Primary sale rules apply. Collector resale inspections become
                  available after the first sale.
                </p>
              )}
              {view.list ? (
                <Link
                  className="btn btn-l cut-s mt-1.5 self-start"
                  href={view.list.href}
                >
                  {view.list.label}
                </Link>
              ) : page.canRequest ? (
                <button
                  type="button"
                  className="btn btn-l cut-s mt-1.5 self-start"
                  disabled={state.busy}
                  onClick={() => void workflow?.request()}
                >
                  Request inspection
                </button>
              ) : null}
            </section>

            <section
              className="panel cut panel-lg"
              aria-labelledby="resale-scope-title"
            >
              <h2 id="resale-scope-title" className="h3">
                What the approval depends on
              </h2>
              <dl className="mt-4 mb-0">
                <div className="kv">
                  <dt>Current owner</dt>
                  <dd>
                    You, <span className="id">{shortAddress(page.ownerWallet)}</span>
                  </dd>
                </div>
                <div className="kv">
                  <dt>Physical custody</dt>
                  <dd>
                    {page.custodyState === "COLLECTOR_HELD"
                      ? "With you"
                      : "Held by Katha"}
                    , revision {page.custodyRevision}
                  </dd>
                </div>
                <div className="kv">
                  <dt>Latest inspection</dt>
                  <dd>
                    Version {page.inspection.version}, inspected{" "}
                    {when(page.inspection.inspectedAt)}
                  </dd>
                </div>
                <div className="kv">
                  <dt>Approval</dt>
                  <dd>{approvalText[page.inspection.status]}</dd>
                </div>
                <div className="kv">
                  <dt>Valid until</dt>
                  <dd>
                    {page.inspection.validUntil
                      ? `${page.inspection.status === "EXPIRED" ? "Ended " : ""}${when(page.inspection.validUntil)}`
                      : "Not applicable"}
                  </dd>
                </div>
              </dl>
              <details className="more mt-2">
                <summary>Recorded report</summary>
                <dl className="m-0">
                  <div className="kv">
                    <dt>Report address</dt>
                    <dd className="id">{page.inspection.report}</dd>
                  </div>
                  <div className="kv">
                    <dt>Report commitment</dt>
                    <dd className="id">{page.inspection.hash}</dd>
                  </div>
                  <div className="kv">
                    <dt>Observed</dt>
                    <dd>{when(page.chainTime)}</dd>
                  </div>
                </dl>
              </details>
              <button
                type="button"
                className="lnk mt-2"
                disabled={state.busy}
                onClick={() => void workflow?.read()}
              >
                Refresh inspection status
              </button>
            </section>

            <section
              aria-labelledby="resale-history-title"
              className="flex flex-col gap-3"
            >
              <h2 id="resale-history-title" className="h3">
                Request history
              </h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {page.requests.map((request) => {
                  const scoped = inScope(page, request);
                  const [tone, text]: [Tone, string] = !scoped
                    ? ["err", "Owner or custody changed"]
                    : page.inspection.status === "APPROVED"
                      ? ["ok", "Approved"]
                      : ["info", "Requested"];
                  return (
                    <li
                      key={request.id}
                      className="panel cut-s flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
                      style={{ padding: "16px 20px" }}
                    >
                      <div className="min-w-0">
                        <p className="m-0 font-semibold">Resale inspection</p>
                        <p className="xs mut m-0">
                          Requested {localDateTime(request.requestedAt)}
                        </p>
                      </div>
                      <Badge tone={tone}>{text}</Badge>
                    </li>
                  );
                })}
                <li
                  className="panel cut-s flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
                  style={{ padding: "16px 20px" }}
                >
                  <div className="min-w-0">
                    <p className="m-0 font-semibold">Latest condition inspection</p>
                    <p className="xs mut m-0">
                      Version {page.inspection.version}, inspected{" "}
                      {when(page.inspection.inspectedAt, true)}
                    </p>
                  </div>
                  <Badge tone="neu">On record</Badge>
                </li>
              </ul>
            </section>
          </>
        )}
      </div>
      <aside className="flex min-w-0 flex-col gap-3" style={{ flex: "1 1 320px" }}>
        <h2 className="h3 text-xl">Why it depends on who holds the painting</h2>
        <div className="panel cut-s flex flex-col gap-1.5 p-5">
          <p className="serif m-0 text-lg font-semibold text-madder">Held by Katha</p>
          <p className="p sm">
            Katha has had the painting in its care, so its recorded condition still
            applies. You can list it without a new inspection.
          </p>
        </div>
        <div className="panel cut-s flex flex-col gap-1.5 p-5">
          <p className="serif m-0 text-lg font-semibold text-madder">Held by you</p>
          <p className="p sm">
            The painting has been outside Katha&apos;s care, so Katha inspects it in
            person first. The approval is tied to you, your custody and that inspection,
            and lasts for a limited time.
          </p>
        </div>
        <p className="xs mut mt-1 mb-0">
          If ownership or custody changes after an approval, it no longer applies and a
          new inspection is needed. A request alone doesn&apos;t verify condition or
          approve a sale.
        </p>
      </aside>
    </div>
  );
}

function VerifierRequests({
  state,
  onRefresh,
  signedIn,
}: {
  state: typeof emptyResaleSnapshot;
  onRefresh: () => void;
  signedIn: boolean;
}) {
  const page = state.page;
  return (
    <section
      className="panel cut"
      aria-labelledby="resale-inspection-title"
      aria-busy={state.busy}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="resale-inspection-title" className="h3">
          Collector resale requests
        </h2>
        {page && (
          <Badge tone={page.requests.length ? "info" : "neu"}>
            {page.requests.length ? "Requested" : "None"}
          </Badge>
        )}
      </div>
      {!signedIn && (
        <p className="p sm mt-3">
          Sign in with an authorized verifier wallet to see requests.
        </p>
      )}
      {state.busy && (
        <p role="status" className="p sm mt-3">
          Checking requests…
        </p>
      )}
      {state.error && (
        <p role="alert" className="ferr mt-3">
          {state.error}
        </p>
      )}
      {page && (
        <>
          {!page.requests.length && (
            <p className="p sm mt-3">No saved requests for this work.</p>
          )}
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {page.requests.map((request) => (
              <li
                key={request.id}
                className="inset flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
              >
                <div className="min-w-0">
                  <p className="m-0 font-semibold">
                    Owner requested a resale inspection
                  </p>
                  <p className="xs mut m-0">
                    <span className="id">{shortAddress(request.ownerWallet)}</span>,{" "}
                    {localDateTime(request.requestedAt)}, custody revision{" "}
                    {request.custodyRevision}
                  </p>
                </div>
                <Badge tone={inScope(page, request) ? "info" : "err"}>
                  {inScope(page, request) ? "In scope" : "Scope changed"}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="xs mut mt-3 mb-0">
            Use reason &ldquo;Before resale&rdquo; in the report below for a secondary
            sale. Approval comes only from a finalized verifier-signed report matching
            the current owner and custody revision. Collectors can&apos;t self-approve.
          </p>
        </>
      )}
      <button
        type="button"
        className="lnk mt-2"
        disabled={state.busy || !signedIn}
        onClick={onRefresh}
      >
        Refresh requests
      </button>
    </section>
  );
}
