"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import { createPublicApi } from "../lib/public-api";
import {
  createOwnerListing,
  emptyOwnerListingSnapshot,
  listingExpiry,
  testTokenBaseUnits,
  type OwnerListing,
} from "../lib/owner-listing";
import {
  localDateTime,
  shortAddress,
  tokenAmount,
  unixSecondsIso,
} from "../lib/format";
import { signInHref } from "../lib/return-path";
import { TransactionReviewView } from "./transaction-review";
import { Badge, FieldTag, Notice, type Tone } from "./ui/status";

const noop = () => () => {};
const emptyAuth = () => signedOutSnapshot;
const emptyState = () => emptyOwnerListingSnapshot;
const emptyFlow = () => idleTransactionSnapshot;
const custodyText = {
  KATHA_HELD: "Held by Katha",
  COLLECTOR_HELD: "With you",
};

function when(seconds: string) {
  try {
    return localDateTime(unixSecondsIso(seconds));
  } catch {
    return `${seconds} Unix seconds`;
  }
}

export function OwnerListingPanel({
  kathaId,
  apiOrigin,
}: {
  kathaId: string;
  apiOrigin: string;
}) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [workflow, setWorkflow] = useState<OwnerListing | null>(null);
  useEffect(() => {
    if (!session || !connection || !transactions) return;
    const current = createOwnerListing(
      session,
      connection,
      transactions,
      createPublicApi(apiOrigin),
      kathaId,
    );
    setWorkflow(current);
    return () => current.dispose();
  }, [session, connection, transactions, apiOrigin, kathaId]);
  useEffect(() => {
    if (auth.status === "signed-in") void workflow?.read();
  }, [workflow, auth.status, auth.session]);
  const state = useSyncExternalStore(
    workflow?.subscribe ?? noop,
    workflow?.getSnapshot ?? emptyState,
    emptyState,
  );
  const flow = useSyncExternalStore(
    transactions?.subscribe ?? noop,
    transactions?.getSnapshot ?? emptyFlow,
    emptyFlow,
  );
  useEffect(() => {
    if (
      flow.phase === "indexed" &&
      flow.operation?.kathaId === kathaId &&
      (flow.operation.kind === "CREATE_LISTING" ||
        flow.operation.kind === "CANCEL_LISTING")
    )
      void workflow?.read();
  }, [workflow, flow.phase, flow.operation?.operationId, kathaId]);
  const [price, setPrice] = useState(""),
    [expiry, setExpiry] = useState(""),
    [errors, setErrors] = useState<{ price?: string; expiry?: string }>({}),
    [confirmCancel, setConfirmCancel] = useState(false);
  // Private form input never outlives the session it was entered under.
  useEffect(() => {
    setPrice("");
    setExpiry("");
    setErrors({});
    setConfirmCancel(false);
  }, [auth.session]);
  if (!auth.session)
    return (
      <div className="panel cut panel-empty mt-8">
        <p className="empty-title">Sign in to manage this listing</p>
        <p className="p max-w-xl">
          Only the owner wallet can list or cancel. Connect your wallet and sign in to
          continue.
        </p>
        <Link
          className="btn btn-p cut-s mt-2"
          href={signInHref(`/collection/${kathaId}/list`)}
        >
          Sign in
        </Link>
      </div>
    );
  const page = state.page;
  const ledger = page?.listing ?? null;
  const expired =
    ledger?.status === "ACTIVE" && BigInt(page!.chainTime) >= BigInt(ledger.expiresAt);
  const active = ledger?.status === "ACTIVE" && !expired;
  const listingTx =
    (flow.operation?.kind === "CREATE_LISTING" ||
      flow.operation?.kind === "CANCEL_LISTING") &&
    flow.operation.kathaId === kathaId;
  const isOwner = page && page.owner === auth.session.walletAddress;
  const eligible = state.approval?.canList === true;
  const status: [Tone, string] =
    listingTx && flow.phase === "signing"
      ? ["info", "Waiting for wallet"]
      : listingTx && flow.phase === "review"
        ? ["info", "Ready to approve"]
        : active
          ? ["ok", "Active"]
          : expired
            ? ["warn", "Expired"]
            : page && isOwner && state.approval && !eligible
              ? ["warn", "Not eligible"]
              : ["neu", "Not listed"];
  function review(event: React.FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    try {
      if (BigInt(testTokenBaseUnits(price.trim())) <= 0n) throw new Error("zero");
    } catch {
      next.price = "Enter a price greater than 0, with up to six decimal places.";
    }
    try {
      listingExpiry(expiry);
    } catch {
      next.expiry = "Choose a time in the future.";
    }
    setErrors(next);
    if (!next.price && !next.expiry) void workflow?.prepare(price.trim(), expiry);
  }
  const errorCount = Number(Boolean(errors.price)) + Number(Boolean(errors.expiry));
  return (
    <div className="workflow-layout mt-8">
      <div className="flex min-w-0 flex-col gap-6">
        <section
          className="panel cut panel-lg"
          aria-labelledby="owner-listing-title"
          aria-busy={state.busy}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <h2 id="owner-listing-title" className="h3">
              Listing status
            </h2>
            <Badge tone={status[0]} role="status">
              {status[1]}
            </Badge>
          </div>
          {state.busy && !page && (
            <p role="status" className="p mt-4">
              Checking listing state…
            </p>
          )}
          {page && (
            <dl className="mt-4 mb-0">
              <div className="kv">
                <dt>Current owner</dt>
                <dd>
                  {isOwner ? (
                    <>
                      You, <span className="id">{shortAddress(page.owner)}</span>
                    </>
                  ) : (
                    <span className="id">{page.owner}</span>
                  )}
                </dd>
              </div>
              <div className="kv">
                <dt>Physical custody</dt>
                <dd>
                  {state.approval
                    ? custodyText[state.approval.custodyState]
                    : "Not available"}
                </dd>
              </div>
              <div className="kv">
                <dt>Sale eligibility</dt>
                <dd>
                  {!state.approval
                    ? "Not available"
                    : eligible
                      ? "Eligible to list"
                      : "Needs an approved resale inspection"}
                </dd>
              </div>
              <div className="kv">
                <dt>Price</dt>
                <dd>
                  {ledger ? `${tokenAmount(ledger.price)} Katha test token` : "Not set"}
                </dd>
              </div>
              <div className="kv">
                <dt>Expires</dt>
                <dd>
                  {ledger
                    ? `${expired ? "Ended " : ""}${when(ledger.expiresAt)}`
                    : "Not set"}
                </dd>
              </div>
              <div className="kv">
                <dt>Revision</dt>
                <dd>
                  {page.currentRevision === "0" ? "None yet" : page.currentRevision}
                </dd>
              </div>
            </dl>
          )}
          <button
            type="button"
            className="lnk mt-3"
            disabled={state.busy}
            onClick={() => void workflow?.read()}
          >
            Refresh listing state
          </button>
        </section>

        {state.error && (
          <Notice tone="err">
            <p>{state.error}</p>
          </Notice>
        )}

        {page && isOwner && state.approval && !eligible && !ledger?.active && (
          <Notice tone="warn" icon="warning">
            <p>
              <strong>This work can&apos;t be listed yet.</strong>{" "}
              {state.approval.custodyState === "COLLECTOR_HELD"
                ? "You hold the painting yourself, so Katha needs to inspect it before resale. Once the inspection is approved, you can list it here."
                : "Its current inspection doesn't permit a listing yet. Check inspection and resale for what's needed."}
            </p>
            <Link
              className="btn btn-p btn-sm cut-s self-start"
              href={`/collection/${kathaId}/resale`}
            >
              Request inspection
            </Link>
          </Notice>
        )}

        {workflow?.canPrepare() && !listingTx && (
          <form
            className="panel cut panel-lg flex flex-col gap-5"
            aria-labelledby="listing-form-title"
            onSubmit={review}
            noValidate
          >
            <div className="flex flex-col gap-1">
              <h2 id="listing-form-title" className="h3">
                List for sale
              </h2>
              <p className="p sm">
                Set a fixed price in Katha test token and when the listing should end.
              </p>
            </div>
            {errorCount > 0 && (
              <Notice tone="err">
                <p>
                  <strong>
                    {errorCount === 1 ? "One field needs" : "Two fields need"}{" "}
                    attention.
                  </strong>{" "}
                  Your entries are kept.
                </p>
              </Notice>
            )}
            <div className="g2" style={{ gap: "20px 24px" }}>
              <div className="fld">
                <label className="lbl" htmlFor="listing-price">
                  Price <FieldTag kind="req" />
                </label>
                <div className="unit">
                  <input
                    id="listing-price"
                    className="inp"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    aria-invalid={errors.price ? true : undefined}
                    aria-describedby="listing-price-help"
                    required
                  />
                  <span>test token</span>
                </div>
                {errors.price && <p className="ferr">{errors.price}</p>}
                <p id="listing-price-help" className="help">
                  Buyers pay exactly this. They see how it&apos;s split before they buy.
                  Up to six decimals, converted exactly to base units.
                </p>
              </div>
              <div className="fld">
                <label className="lbl" htmlFor="listing-expiry">
                  Listing ends <FieldTag kind="req" />
                </label>
                <input
                  id="listing-expiry"
                  className="inp"
                  type="datetime-local"
                  value={expiry}
                  onChange={(event) => setExpiry(event.target.value)}
                  aria-invalid={errors.expiry ? true : undefined}
                  aria-describedby="listing-expiry-help"
                  required
                />
                {errors.expiry && <p className="ferr">{errors.expiry}</p>}
                <p id="listing-expiry-help" className="help">
                  Shown in your local time (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}).
                </p>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-p cut-s self-start"
              disabled={state.busy}
            >
              Review listing
            </button>
          </form>
        )}

        {listingTx && (
          <TransactionReviewView
            id="listing-transaction-review"
            title={
              flow.operation?.kind === "CANCEL_LISTING"
                ? "Cancel listing"
                : "Review listing"
            }
            state={flow}
            onApprove={() => void transactions?.approveAndSend()}
            onCheck={() => void transactions?.checkConfirmation()}
            onCancel={() => transactions?.cancel()}
          />
        )}

        {active && !listingTx && (
          <section
            className="panel cut panel-lg flex flex-col gap-3.5"
            aria-labelledby="listing-live-title"
          >
            <h2 id="listing-live-title" className="h3">
              Your listing is live
            </h2>
            <p className="p">
              Buyers can see it on the artwork record. The digital asset stays locked in
              the listing until it sells, you cancel, or it expires.
            </p>
            {confirmCancel ? (
              <div
                className="confirm"
                role="alertdialog"
                aria-labelledby="cancel-title"
                aria-describedby="cancel-body"
              >
                <p id="cancel-title" className="confirm-title">
                  Cancel this listing?
                </p>
                <p id="cancel-body" className="p sm">
                  The asset unlocks and the work stops being for sale. You&apos;ll
                  approve one transaction in your wallet. Physical custody doesn&apos;t
                  change.
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    type="button"
                    className="btn btn-d cut-s"
                    disabled={!workflow?.canRelease()}
                    onClick={() => {
                      setConfirmCancel(false);
                      void workflow?.release();
                    }}
                  >
                    Cancel listing
                  </button>
                  <button
                    type="button"
                    className="lnk"
                    onClick={() => setConfirmCancel(false)}
                  >
                    Keep listing
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-o self-start"
                disabled={!workflow?.canRelease()}
                onClick={() => setConfirmCancel(true)}
              >
                Cancel listing
              </button>
            )}
          </section>
        )}

        {expired && !listingTx && (
          <section
            className="panel cut panel-lg flex flex-col gap-3.5"
            aria-labelledby="listing-expired-title"
          >
            <h2 id="listing-expired-title" className="h3">
              This listing expired
            </h2>
            <p className="p">
              It ended {when(ledger!.expiresAt)} without a sale. The asset stays locked
              until you release the listing; then you can list it again.
            </p>
            <button
              type="button"
              className="btn btn-p cut-s self-start"
              disabled={!workflow?.canRelease()}
              onClick={() => void workflow?.release()}
            >
              Release expired listing
            </button>
          </section>
        )}

        {state.reloadRequired && !listingTx && (
          <p role="status" className="p sm">
            Check the transaction outcome, then refresh listing state before preparing
            again.
          </p>
        )}
      </div>
      <aside
        className="panel flex min-w-0 flex-col gap-5"
        style={{ flex: "1 1 300px" }}
      >
        <div className="flex flex-col gap-1.5">
          <h2 className="h3 h3-aside">Listing locks the asset</h2>
          <p className="p sm">
            While a work is listed, its digital asset is held in the listing so it
            can&apos;t be sent elsewhere. You remain the owner until a sale is
            finalized.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="h3 h3-aside">Fixed price only</h2>
          <p className="p sm">
            Buyers pay the price you set. The artist&apos;s proceeds and Katha&apos;s
            commission come out of it, as shown before they buy.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="h3 h3-aside">Who holds the painting</h2>
          <p className="p sm">
            If Katha holds it, you can list right away. If you hold it, Katha inspects
            it first so buyers can trust its condition. Preparation rechecks
            eligibility.
          </p>
        </div>
      </aside>
    </div>
  );
}
