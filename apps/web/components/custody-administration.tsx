"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  custodyPreparationRequestSchema,
  fulfillmentUpdateRequestSchema,
  type CustodyAdministrationReview,
  type PhysicalCustodyState,
} from "@katha/shared";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import {
  createCustodyAdministrationWorkflow,
  emptyCustodySnapshot,
  type CustodyAdministrationWorkflow,
} from "../lib/custody-administration";
import { localDateTime, shortAddress } from "../lib/format";
import { TransactionReviewView } from "./transaction-review";
import { OpsSignedOut, ReceiptLine } from "./ops-ui";
import { Badge, FieldTag, Notice, type Tone } from "./ui/status";

const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyCustodySnapshot;
const custody: Record<PhysicalCustodyState, { tone: Tone; text: string }> = {
  UNKNOWN: { tone: "neu", text: "Not recorded" },
  KATHA_HELD: { tone: "neu", text: "Held by Katha" },
  COLLECTOR_HELD: { tone: "ok", text: "With the owner" },
  IN_TRANSIT: { tone: "info", text: "In transit" },
};
const actionLabels: Record<string, string> = {
  ATTEST_KATHA_CUSTODY: "Record that Katha holds the work",
  ATTEST_COLLECTOR_CUSTODY: "Record that a collector holds the work",
  DISPATCH_FROM_KATHA: "Dispatched from Katha",
  DISPATCH_FROM_COLLECTOR: "Dispatched by the collector",
  RECEIVE_AT_KATHA: "Received at Katha",
  RECEIVE_BY_COLLECTOR: "Received by the collector",
};
const statusActions: Record<string, string> = {
  APPROVED: "Approve request",
  DISPATCHED: "Mark dispatched",
  RECEIVED: "Mark received",
  CANCELLED: "Cancel request",
};
const flowSteps = ["REQUESTED", "APPROVED", "DISPATCHED", "RECEIVED"] as const;
const flowLabels = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  DISPATCHED: "Dispatched",
  RECEIVED: "Received",
};

export function CustodyAdministrationPanel({ kathaId }: { kathaId: string }) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<CustodyAdministrationWorkflow | null>(null);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const value = createCustodyAdministrationWorkflow(
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
  if (!auth.session)
    return (
      <OpsSignedOut path={`/admin/artworks/${kathaId}/custody`} role="administrator" />
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
  const disabled = state.busy || state.reloadRequired || !free;
  const page = state.page;
  const held = page ? custody[page.chain.state] : null;
  const tx =
    flow.operation?.kind === "UPDATE_CUSTODY" && flow.operation.kathaId === kathaId;
  return (
    <div className="flex flex-col gap-6" aria-busy={state.busy}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className="p max-w-[46rem]">
          Confirm actual movement in person. Delivery requests and their contact details
          stay private. Updating a request and recording custody on chain are separate
          actions; digital ownership and artist attribution don&apos;t change.
        </p>
        {held && (
          <Badge tone={held.tone} role="status">
            {held.text}
          </Badge>
        )}
      </div>
      {state.busy && !page && (
        <p role="status" className="p">
          Checking saved custody state…
        </p>
      )}
      {state.error && (
        <Notice tone="err">
          <p>{state.error}</p>
          {!page && (
            <button
              className="btn btn-o btn-sm self-start"
              type="button"
              disabled={state.busy}
              onClick={() => void workflow?.read()}
            >
              Reload custody state
            </button>
          )}
        </Notice>
      )}
      {page && held && (
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-col gap-5" style={{ flex: "999 1 620px" }}>
            {page.custody.unresolved && (
              <Notice tone="warn" icon="warning">
                <p>
                  <strong>A signed custody transaction is unresolved.</strong> Check its
                  saved reference before preparing another movement.
                </p>
              </Notice>
            )}
            {!page.requests.length && (
              <div className="panel cut flex flex-col gap-2">
                <h2 className="h3">No open delivery or return requests</h2>
                <p className="p sm">
                  When the owner asks for delivery or a return to Katha, it appears here
                  for review.
                </p>
              </div>
            )}
            {page.requests.map((row) => (
              <FulfillmentCard
                key={`${row.request.id}:${row.request.updatedAt}`}
                row={row}
                workflow={workflow!}
                disabled={disabled}
              />
            ))}
            {(page.pagination.offset > 0 || page.pagination.hasMore) && (
              <nav
                aria-label="Fulfillment request pages"
                className="flex flex-wrap gap-2"
              >
                <button
                  className="btn btn-o btn-sm"
                  type="button"
                  disabled={state.busy || page.pagination.offset === 0}
                  onClick={() =>
                    void workflow?.read(Math.max(0, page.pagination.offset - 20))
                  }
                >
                  Previous requests
                </button>
                <button
                  className="btn btn-o btn-sm"
                  type="button"
                  disabled={
                    state.busy ||
                    !page.pagination.hasMore ||
                    page.pagination.offset > 99980
                  }
                  onClick={() => void workflow?.read(page.pagination.offset + 20)}
                >
                  Next requests
                </button>
              </nav>
            )}
            <MovementForm
              key={`${auth.session.walletId}:${page.chain.revision}:${page.updatedAt}:${page.requests.map((r) => r.request.updatedAt).join(":")}`}
              page={page}
              workflow={workflow!}
              disabled={disabled || page.custody.unresolved || !page.canAttest}
              supportedVersions={[
                ...(connection?.getSnapshot().connected?.supportsV0
                  ? [0 as const]
                  : []),
                ...(connection?.getSnapshot().connected?.supportsV1
                  ? [1 as const]
                  : []),
              ]}
            />
            {tx && (
              <TransactionReviewView
                state={flow}
                id="custody-transaction-title"
                title="Custody transaction"
                onApprove={() => void transactions?.approveAndSend()}
                onCheck={() => void transactions?.checkConfirmation()}
                onCancel={() => transactions?.cancel()}
              />
            )}
          </div>
          <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 320px" }}>
            <section className="panel cut-s" aria-labelledby="custody-current">
              <h2 id="custody-current" className="h3">
                Current record
              </h2>
              <dl className="mt-2.5 mb-0">
                <div className="kv kv-ops">
                  <dt>Custody</dt>
                  <dd>{held.text}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Custodian</dt>
                  <dd className="id">
                    {page.chain.subject ?? "No held custodian recorded"}
                  </dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Owner</dt>
                  <dd className="id">{page.chain.ownerWallet ?? "Not minted yet"}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Revision</dt>
                  <dd>{page.chain.revision}</dd>
                </div>
                <div className="kv kv-ops">
                  <dt>Custody authority</dt>
                  <dd className="id">{page.chain.custodyAuthority}</dd>
                </div>
              </dl>
            </section>
            <section className="panel cut-s" aria-labelledby="custody-transitions">
              <h2 id="custody-transitions" className="h3">
                Permitted transitions
              </h2>
              {page.transitions.length ? (
                page.transitions.map((transition) => (
                  <div key={transition.action} className="tr">
                    <span className="sm">{actionLabels[transition.action]}</span>
                    <Badge tone="info" marker={false}>
                      Allowed
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="p sm mt-2">
                  No movement is permitted from the current custody.
                </p>
              )}
              {!page.canAttest && (
                <p className="help mt-2.5">
                  Your wallet can coordinate requests. The registry&apos;s custody
                  authority signs custody records.
                </p>
              )}
            </section>
            {page.custody.receipt && (
              <ReceiptLine
                receipt={page.custody.receipt}
                cluster={page.cluster}
                label="Latest custody transaction"
              />
            )}
            <button
              className="lnk self-start"
              type="button"
              disabled={state.busy}
              onClick={() => void workflow?.read()}
            >
              Reload custody state
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}

function MovementForm({
  page,
  workflow,
  disabled,
  supportedVersions,
}: {
  page: CustodyAdministrationReview;
  workflow: CustodyAdministrationWorkflow;
  disabled: boolean;
  supportedVersions: (0 | 1)[];
}) {
  const [requestId, setRequestId] = useState(""),
    [action, setAction] = useState(""),
    [collector, setCollector] = useState(page.chain.ownerWallet ?? ""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(false);
  const transitions = requestId
    ? (page.requests.find((row) => row.request.id === requestId)?.transitions ?? [])
    : page.transitions;
  const transition = transitions.find((row) => row.action === action);
  return (
    <form
      className="panel cut panel-lg flex flex-col gap-4"
      aria-labelledby="custody-movement"
      onSubmit={(event) => {
        event.preventDefault();
        const result = custodyPreparationRequestSchema.safeParse({
          expectedUpdatedAt: page.updatedAt,
          expectedCustodyRevision: page.chain.revision,
          transition,
          collectorWallet: transition?.to === "COLLECTOR_HELD" ? collector : null,
          movementConfirmed: confirmed,
          ...(requestId ? { fulfillmentId: requestId } : {}),
          idempotencyKey: `custody-${crypto.randomUUID()}`,
          supportedTransactionVersions: supportedVersions,
        });
        if (!result.success) {
          setError(true);
          return;
        }
        setError(false);
        setConfirmed(false);
        void workflow.prepare(result.data);
      }}
    >
      <h2 id="custody-movement" className="h2 h2-ops">
        Record custody change
      </h2>
      <p className="p sm -mt-1.5">
        Updating a fulfillment request doesn&apos;t change the artwork&apos;s record.
        Recording custody is a separate, reviewed transaction, available once the
        painting has physically moved.
      </p>
      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="sr-only">Record completed physical movement</legend>
        <div className="g2">
          <div className="fld">
            <label className="lbl" htmlFor="custody-request">
              Related request <FieldTag kind="opt" />
            </label>
            <select
              id="custody-request"
              aria-label="Related fulfillment request"
              className="inp"
              value={requestId}
              onChange={(event) => {
                setRequestId(event.target.value);
                setAction("");
                setConfirmed(false);
              }}
            >
              <option value="">No request (manual record)</option>
              {page.requests
                .filter((row) => row.transitions.length)
                .map((row) => (
                  <option key={row.request.id} value={row.request.id}>
                    {row.request.kind === "DELIVERY" ? "Delivery" : "Return"},{" "}
                    {row.request.recipientName}
                  </option>
                ))}
            </select>
          </div>
          <div className="fld">
            <label className="lbl" htmlFor="custody-action">
              Physical movement <FieldTag kind="req" />
            </label>
            <select
              id="custody-action"
              aria-label="Physical movement"
              className="inp"
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Choose a permitted movement</option>
              {transitions.map((row) => (
                <option key={row.action} value={row.action}>
                  {actionLabels[row.action]}: {custody[row.from].text} →{" "}
                  {custody[row.to].text}
                </option>
              ))}
            </select>
          </div>
          {transition?.to === "COLLECTOR_HELD" && (
            <div className="fld span-all">
              <label className="lbl" htmlFor="custody-collector">
                Receiving collector wallet <FieldTag kind="req" />
              </label>
              <input
                id="custody-collector"
                className="inp id font-medium"
                value={collector}
                disabled={page.chain.ownerWallet !== null}
                maxLength={44}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setCollector(event.target.value);
                  setConfirmed(false);
                }}
              />
            </div>
          )}
        </div>
        {transition && (
          <dl className="m-0">
            <div className="kv kv-ops">
              <dt>From</dt>
              <dd>
                {custody[transition.from].text} (revision {page.chain.revision})
              </dd>
            </div>
            <div className="kv kv-ops">
              <dt>To</dt>
              <dd>
                {custody[transition.to].text}
                {transition.to === "COLLECTOR_HELD" && collector
                  ? `, ${shortAddress(collector)}`
                  : ""}
              </dd>
            </div>
          </dl>
        )}
        <label className="chk chk-box">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            I confirmed that this physical movement has already happened and the
            receiving custodian is correct.
          </span>
        </label>
        {error && (
          <p role="alert" className="ferr">
            Choose a permitted movement, confirm it happened and give the receiving
            collector wallet when needed.
          </p>
        )}
        <button
          className="btn btn-p cut-s self-start"
          disabled={!transition || !confirmed || !supportedVersions.length}
        >
          Review custody change
        </button>
      </fieldset>
    </form>
  );
}

function FulfillmentCard({
  row,
  workflow,
  disabled,
}: {
  row: CustodyAdministrationReview["requests"][number];
  workflow: CustodyAdministrationWorkflow;
  disabled: boolean;
}) {
  const request = row.request;
  const [courier, setCourier] = useState(request.courier ?? ""),
    [tracking, setTracking] = useState(request.trackingReference ?? ""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState<string | null>(null);
  const position = flowSteps.indexOf(request.status as (typeof flowSteps)[number]);
  const editsCourier = request.status === "REQUESTED" || request.status === "APPROVED";
  function save(status: string) {
    if (status === "DISPATCHED" && !courier.trim()) {
      setError("Enter the courier before marking the request dispatched.");
      return;
    }
    const result = fulfillmentUpdateRequestSchema.safeParse({
      expectedUpdatedAt: request.updatedAt,
      status,
      manualConfirmation: confirmed,
      ...(editsCourier
        ? {
            courier: courier.trim() || null,
            trackingReference: tracking.trim() || null,
          }
        : {}),
    });
    if (!result.success) {
      setError("Confirm the manual update before saving.");
      return;
    }
    setError(null);
    setConfirmed(false);
    void workflow.update(request.id, result.data);
  }
  return (
    <section
      className="panel cut panel-lg flex flex-col gap-3.5"
      aria-labelledby={`request-${request.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id={`request-${request.id}`} className="h2 h2-ops">
          {request.kind === "DELIVERY" ? "Delivery request" : "Return to Katha"}
        </h2>
        <FieldTag kind="priv">Private fulfillment record</FieldTag>
      </div>
      {request.status === "CANCELLED" ? (
        <Badge tone="err" className="self-start">
          Cancelled
        </Badge>
      ) : (
        <ol className="flow" aria-label="Request status">
          {flowSteps.map((step, index) => (
            <li
              key={step}
              className={`cut-s${index < position ? " done" : index === position ? " now" : ""}`}
            >
              {flowLabels[step]}
              <span className="sr-only">
                {index < position ? ", done" : index === position ? ", current" : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
      <dl className="m-0">
        <div className="kv kv-ops">
          <dt>Requested</dt>
          <dd>
            {localDateTime(request.createdAt)}, updated{" "}
            {localDateTime(request.updatedAt)}
          </dd>
        </div>
        <div className="kv kv-ops">
          <dt>Recipient</dt>
          <dd>{request.recipientName}</dd>
        </div>
        <div className="kv kv-ops">
          <dt>Contact</dt>
          <dd>
            {[request.contactEmail, request.contactPhone].filter(Boolean).join(", ")}
          </dd>
        </div>
        <div className="kv kv-ops">
          <dt>Address</dt>
          <dd>
            {[
              ...request.addressLines,
              request.city,
              request.region,
              request.postalCode,
              request.countryCode,
            ]
              .filter(Boolean)
              .join(", ")}
          </dd>
        </div>
        {request.deliveryInstructions && (
          <div className="kv kv-ops">
            <dt>Instructions</dt>
            <dd>{request.deliveryInstructions}</dd>
          </div>
        )}
        {request.courier && (
          <div className="kv kv-ops">
            <dt>Courier</dt>
            <dd>{request.courier}</dd>
          </div>
        )}
        {request.trackingReference && (
          <div className="kv kv-ops">
            <dt>Tracking</dt>
            <dd className="id">{request.trackingReference}</dd>
          </div>
        )}
        {request.ownerReportedReceivedAt && (
          <div className="kv kv-ops">
            <dt>Owner reported</dt>
            <dd>
              Received, {localDateTime(request.ownerReportedReceivedAt)}. This still
              needs manual confirmation; custody is recorded separately.
            </dd>
          </div>
        )}
      </dl>
      {!row.ownerMatches && (
        <Notice tone="warn">
          <p>
            <strong>The requester is no longer the digital owner.</strong> Only
            cancellation is available.
          </p>
        </Notice>
      )}
      {row.allowedStatuses.length > 0 && (
        <fieldset className="inset flex flex-col gap-3.5" disabled={disabled}>
          <legend className="sr-only">Update this request</legend>
          {editsCourier && row.allowedStatuses.includes("DISPATCHED") && (
            <div className="g2">
              <div className="fld">
                <label className="lbl" htmlFor={`courier-${request.id}`}>
                  Courier <FieldTag kind="req">Required to dispatch</FieldTag>
                </label>
                <input
                  id={`courier-${request.id}`}
                  className="inp"
                  maxLength={120}
                  value={courier}
                  onChange={(event) => setCourier(event.target.value)}
                />
              </div>
              <div className="fld">
                <label className="lbl" htmlFor={`tracking-${request.id}`}>
                  Tracking number <FieldTag kind="opt" />
                </label>
                <input
                  id={`tracking-${request.id}`}
                  className="inp"
                  maxLength={200}
                  value={tracking}
                  onChange={(event) => setTracking(event.target.value)}
                />
              </div>
            </div>
          )}
          <label className="chk">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I confirmed this update manually. Saving it doesn&apos;t record custody on
              chain.
            </span>
          </label>
          {error && (
            <p role="alert" className="ferr">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {row.allowedStatuses
              .filter((status) => status !== "CANCELLED")
              .map((status) => (
                <button
                  key={status}
                  type="button"
                  className="btn btn-p cut-s"
                  disabled={!confirmed}
                  onClick={() => save(status)}
                >
                  {statusActions[status]}
                </button>
              ))}
            {row.allowedStatuses.includes("CANCELLED") && (
              <button
                type="button"
                className="lnk lnk-err"
                disabled={!confirmed}
                onClick={() => save("CANCELLED")}
              >
                Cancel request
              </button>
            )}
          </div>
          {editsCourier && (
            <p className="help">
              The owner sees the courier and tracking on their delivery page.
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
}
