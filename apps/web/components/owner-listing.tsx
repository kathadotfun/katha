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
  type OwnerListing,
} from "../lib/owner-listing";
import { TransactionReviewView } from "./transaction-review";
const noop = () => () => {};
const emptyAuth = () => signedOutSnapshot;
const emptyState = () => emptyOwnerListingSnapshot;
const emptyFlow = () => idleTransactionSnapshot;
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
  const [price, setPrice] = useState(""),
    [expiry, setExpiry] = useState("");
  useEffect(() => {
    setPrice("");
    setExpiry("");
  }, [auth.session]);
  if (!auth.session)
    return (
      <p className="mt-8" role="status">
        Connect and{" "}
        <Link href="/account" className="text-link">
          sign in with the owner wallet
        </Link>{" "}
        to prepare a listing.
      </p>
    );
  return (
    <section
      className="mt-10 max-w-reading"
      aria-labelledby="owner-listing-title"
      aria-busy={state.busy}
    >
      <h2 id="owner-listing-title" className="text-2xl">
        {kathaId}
      </h2>
      <p className="mt-3 text-sm text-muted">
        {auth.session.cluster === "devnet" ? "Devnet" : "Localnet"} · Six-decimal test
        token · No real-money value
      </p>
      <p className="mt-4 text-sm">
        Collector-held resale requires a current inspection approved for the owner and
        custody state. Katha-held resale uses the applicable condition rules.
        Preparation and chain simulation recheck eligibility and the configured
        inspection validity; an owned work is not automatically eligible.
      </p>
      <button
        type="button"
        className="site-nav-link mt-4"
        disabled={state.busy}
        onClick={() => void workflow?.read()}
      >
        Refresh listing state
      </button>
      {state.busy && (
        <p role="status" className="mt-4">
          Checking listing state and preparation…
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-4">
          {state.error}
        </p>
      )}
      {state.page && (
        <>
          <p className="mt-4 text-sm">
            Observed listing revision: {state.page.currentRevision} · Finalized slot{" "}
            {state.page.observedSlot}
          </p>
          <p className="mt-3 text-sm">
            {state.page.listing?.status === "ACTIVE"
              ? "This listing must be released before another can be created."
              : "A fresh preparation will recheck the current owner and artwork eligibility."}
          </p>
          <form
            className="mt-6 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void workflow?.prepare(price, expiry);
            }}
          >
            <div>
              <label htmlFor="listing-price" className="block">
                Price in test tokens
              </label>
              <input
                id="listing-price"
                className="mt-2 w-full border border-control bg-surface p-3"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                aria-describedby="listing-price-help"
                required
                disabled={!workflow?.canPrepare()}
              />
              <p id="listing-price-help" className="mt-2 text-sm text-muted">
                Use plain decimal notation with up to six places, for example 12.500001.
                Prices are converted exactly to integer base units.
              </p>
            </div>
            <div>
              <label htmlFor="listing-expiry" className="block">
                Listing expiry (your local time)
              </label>
              <input
                id="listing-expiry"
                className="mt-2 w-full border border-control bg-surface p-3"
                type="datetime-local"
                value={expiry}
                onChange={(event) => setExpiry(event.target.value)}
                required
                disabled={!workflow?.canPrepare()}
              />
            </div>
            <button
              type="submit"
              className="button-primary"
              disabled={!workflow?.canPrepare()}
            >
              Prepare listing for review
            </button>
          </form>
          {state.reloadRequired && (
            <p role="status" className="mt-4">
              Review the transaction outcome, then refresh listing state before another
              preparation.
            </p>
          )}
        </>
      )}
      {flow.operation?.kind === "CREATE_LISTING" &&
        flow.operation.kathaId === kathaId && (
          <>
            <p className="mt-6">
              Price: {flow.operation.price} test-token base units · Expiry:{" "}
              {new Date(Number(flow.operation.expiresAt) * 1000).toISOString()}
            </p>
            <TransactionReviewView
              id="listing-transaction-review"
              title="Listing transaction review"
              state={flow}
              onApprove={() => void transactions?.approveAndSend()}
              onCheck={() => void transactions?.checkConfirmation()}
              onCancel={() => transactions?.cancel()}
            />
          </>
        )}
    </section>
  );
}
