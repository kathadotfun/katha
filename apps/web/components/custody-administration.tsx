"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  custodyPreparationRequestSchema,
  fulfillmentUpdateRequestSchema,
  type CustodyAdministrationReview,
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
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {},
  emptyAuth = () => signedOutSnapshot,
  emptyFlow = () => idleTransactionSnapshot,
  emptyPage = () => emptyCustodySnapshot;
const inputClass =
  "mt-2 block w-full min-w-0 min-h-12 border border-muted bg-surface px-3 py-2";
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
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
      <p role="status" className="mt-10">
        Connect and sign in with an administrator wallet in the header to coordinate
        custody.
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
  const disabled = state.busy || state.reloadRequired || !free;
  return (
    <section
      className="admin-workspace mt-10"
      aria-labelledby="custody-controls"
      aria-busy={state.busy}
    >
      <h2 id="custody-controls" className="text-2xl">
        Physical custody and fulfillment
      </h2>
      <p className="mt-4 text-sm text-muted">
        Confirm actual movement in person. Delivery requests and their contact details
        stay private. A fulfillment status update and a Registry custody attestation are
        separate actions; Core ownership and artist attribution stay unchanged.
      </p>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking saved custody state…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      <button
        className="text-link mt-5"
        disabled={state.busy}
        onClick={() => void workflow?.read()}
      >
        Reload custody state
      </button>
      {state.page && (
        <>
          <h3 className="mt-8 text-xl">{state.page.title}</h3>
          <dl className="mt-4 grid gap-3 text-sm">
            <div>
              <dt>Permanent Katha ID</dt>
              <dd>{state.page.kathaId}</dd>
            </div>
            <div>
              <dt>Finalized physical custody</dt>
              <dd>
                {label(state.page.chain.state)} · revision {state.page.chain.revision}
              </dd>
            </div>
            <div>
              <dt>Physical custodian</dt>
              <dd className="break-all">
                {state.page.chain.subject ?? "No held custodian attested"}
              </dd>
            </div>
            <div>
              <dt>Digital owner</dt>
              <dd className="break-all">
                {state.page.chain.ownerWallet ?? "Core asset has not been minted"}
              </dd>
            </div>
            <div>
              <dt>Registry custody authority</dt>
              <dd className="break-all">{state.page.chain.custodyAuthority}</dd>
            </div>
          </dl>
          {state.page.custody.unresolved && (
            <p role="status" className="mt-5">
              A signed custody attempt is unresolved. Check its retained signature
              before preparing another movement.
            </p>
          )}
          {state.page.custody.receipt && (
            <p className="mt-4 text-sm break-all">
              Latest custody receipt: {label(state.page.custody.receipt.status)} ·{" "}
              {state.page.custody.receipt.signature} ·{" "}
              {state.page.custody.receipt.indexed
                ? "Indexed"
                : "Indexing not confirmed"}
            </p>
          )}
          {!state.page.canAttest && (
            <p className="mt-5">
              This administrator can coordinate requests. The current Registry custody
              authority must sign custody attestations.
            </p>
          )}
          <MovementForm
            key={`${auth.session.walletId}:${state.page.chain.revision}:${state.page.updatedAt}:${state.page.requests.map((r) => r.request.updatedAt).join(":")}`}
            page={state.page}
            workflow={workflow!}
            disabled={
              disabled || state.page.custody.unresolved || !state.page.canAttest
            }
            supportedVersions={[
              ...(connection?.getSnapshot().connected?.supportsV0 ? [0 as const] : []),
              ...(connection?.getSnapshot().connected?.supportsV1 ? [1 as const] : []),
            ]}
          />
          <h3 className="mt-10 text-xl">Private fulfillment requests</h3>
          <p className="mt-3 text-sm text-muted">
            Review only for manual delivery coordination. Approval does not dispatch the
            artwork or change on-chain custody. Record dispatch before saving
            “dispatched”, and record receipt before saving “received”.
          </p>
          {!state.page.requests.length && (
            <p className="mt-4">No requests on this page.</p>
          )}
          {state.page.requests.map((row) => (
            <FulfillmentForm
              key={`${row.request.id}:${row.request.updatedAt}`}
              row={row}
              workflow={workflow!}
              disabled={disabled}
            />
          ))}
          <nav
            aria-label="Fulfillment request pages"
            className="mt-6 flex flex-wrap gap-6"
          >
            <button
              className="text-link"
              disabled={state.busy || state.page.pagination.offset === 0}
              onClick={() =>
                void workflow?.read(Math.max(0, state.page!.pagination.offset - 20))
              }
            >
              Previous requests
            </button>
            <button
              className="text-link"
              disabled={
                state.busy ||
                !state.page.pagination.hasMore ||
                state.page.pagination.offset > 99980
              }
              onClick={() => void workflow?.read(state.page!.pagination.offset + 20)}
            >
              Next requests
            </button>
          </nav>
        </>
      )}
      <TransactionReviewView
        state={flow}
        id="custody-transaction-title"
        title="Custody transaction review"
        onApprove={() => void transactions?.approveAndSend()}
        onCheck={() => void transactions?.checkConfirmation()}
        onCancel={() => transactions?.cancel()}
      />
    </section>
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
      className="mt-8 grid gap-5 max-w-reading"
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
      <h3 className="text-xl">Record completed physical movement</h3>
      <label>
        Related fulfillment request
        <select
          aria-label="Related fulfillment request"
          className={inputClass}
          value={requestId}
          disabled={disabled}
          onChange={(e) => {
            setRequestId(e.target.value);
            setAction("");
            setConfirmed(false);
          }}
        >
          <option value="">Manual custody attestation</option>
          {page.requests
            .filter((row) => row.transitions.length)
            .map((row) => (
              <option key={row.request.id} value={row.request.id}>
                {label(row.request.kind)} · {row.request.id}
              </option>
            ))}
        </select>
      </label>
      <label>
        Physical movement
        <select
          aria-label="Physical movement"
          className={inputClass}
          value={action}
          disabled={disabled}
          onChange={(e) => {
            setAction(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="">Select a valid movement</option>
          {transitions.map((row) => (
            <option key={row.action} value={row.action}>
              {label(row.action)} → {label(row.to)}
            </option>
          ))}
        </select>
      </label>
      {transition?.to === "COLLECTOR_HELD" && (
        <label>
          Receiving collector wallet
          <input
            className={inputClass}
            value={collector}
            disabled={disabled || page.chain.ownerWallet !== null}
            maxLength={44}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setCollector(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
      )}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0"
          checked={confirmed}
          disabled={disabled}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirmed that this physical movement has already occurred and the receiving
        custodian is correct.
      </label>
      {error && (
        <p role="alert">
          Select a valid movement, confirm actual custody and provide the receiving
          collector wallet when required.
        </p>
      )}
      <button
        className="text-link justify-self-start"
        disabled={disabled || !transition || !confirmed || !supportedVersions.length}
      >
        Prepare custody attestation
      </button>
    </form>
  );
}
function FulfillmentForm({
  row,
  workflow,
  disabled,
}: {
  row: CustodyAdministrationReview["requests"][number];
  workflow: CustodyAdministrationWorkflow;
  disabled: boolean;
}) {
  const request = row.request;
  const [status, setStatus] = useState(""),
    [courier, setCourier] = useState(request.courier ?? ""),
    [tracking, setTracking] = useState(request.trackingReference ?? ""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(false);
  return (
    <details className="mt-6 border-t border-muted pt-5">
      <summary className="cursor-pointer break-all">
        {label(request.kind)} · {label(request.status)} · {request.id}
      </summary>
      <div className="mt-4 grid gap-3 text-sm break-words">
        <p>Recipient: {request.recipientName}</p>
        <p>
          Contact: {request.contactEmail ?? request.contactPhone}
          {request.contactEmail && request.contactPhone
            ? ` · ${request.contactPhone}`
            : ""}
        </p>
        <p>
          Address: {request.addressLines.join(", ")} · {request.city} ·{" "}
          {[request.region, request.postalCode, request.countryCode]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {request.deliveryInstructions && (
          <p>Delivery instructions: {request.deliveryInstructions}</p>
        )}
        <p>Request updated: {request.updatedAt}</p>
        {!row.ownerMatches && (
          <p>
            The requester is no longer the current digital owner. Only an available
            cancellation is allowed.
          </p>
        )}
        {request.courier && <p>Courier: {request.courier}</p>}
        {request.trackingReference && (
          <p>Tracking reference: {request.trackingReference}</p>
        )}
      </div>
      {!!row.allowedStatuses.length && (
        <form
          className="mt-5 grid gap-5 max-w-reading"
          onSubmit={(event) => {
            event.preventDefault();
            const result = fulfillmentUpdateRequestSchema.safeParse({
              expectedUpdatedAt: request.updatedAt,
              status,
              manualConfirmation: confirmed,
              ...(request.status === "REQUESTED" || request.status === "APPROVED"
                ? {
                    courier: courier.trim() || null,
                    trackingReference: tracking.trim() || null,
                  }
                : {}),
            });
            if (!result.success) {
              setError(true);
              return;
            }
            setError(false);
            setConfirmed(false);
            void workflow.update(request.id, result.data);
          }}
        >
          <label>
            Fulfillment status
            <select
              aria-label="Fulfillment status"
              className={inputClass}
              value={status}
              disabled={disabled}
              onChange={(e) => {
                setStatus(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Select next status</option>
              {row.allowedStatuses.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
          </label>
          {(request.status === "REQUESTED" || request.status === "APPROVED") && (
            <>
              <label>
                Courier
                <input
                  className={inputClass}
                  maxLength={120}
                  value={courier}
                  disabled={disabled}
                  onChange={(e) => {
                    setCourier(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                Tracking reference
                <input
                  className={inputClass}
                  maxLength={200}
                  value={tracking}
                  disabled={disabled}
                  onChange={(e) => {
                    setTracking(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
            </>
          )}
          <label className="flex items-start gap-3">
            <input
              className="mt-1 h-5 w-5 shrink-0"
              type="checkbox"
              checked={confirmed}
              disabled={disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I confirmed this fulfillment status manually. Saving it does not record
            physical custody on chain.
          </label>
          {error && (
            <p role="alert">Select an allowed status and confirm the manual update.</p>
          )}
          <button
            className="text-link justify-self-start"
            disabled={disabled || !status || !confirmed}
          >
            Save fulfillment status
          </button>
        </form>
      )}
    </details>
  );
}
