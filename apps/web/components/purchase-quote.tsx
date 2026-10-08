"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useWalletSession, useWalletConnection } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { createPublicApi } from "../lib/public-api";
import {
  createPurchaseQuote,
  emptyPurchaseQuote,
  testTokenAmount,
  type PurchaseQuoteController,
} from "../lib/purchase-quote";
const noop = () => () => {};
const emptyAuth = () => signedOutSnapshot;
const empty = () => emptyPurchaseQuote;
const custodyLabels = {
  UNKNOWN: "Unconfirmed",
  KATHA_HELD: "In Katha custody",
  COLLECTOR_HELD: "Collector-held",
  IN_TRANSIT: "In transit",
};
export function PurchaseQuotePanel({
  kathaId,
  apiOrigin,
}: {
  kathaId: string;
  apiOrigin: string;
}) {
  const session = useWalletSession(),
    connection = useWalletConnection();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? emptyAuth,
    emptyAuth,
  );
  const [controller, setController] = useState<PurchaseQuoteController | null>(null);
  useEffect(() => {
    if (!session || !connection) return;
    const current = createPurchaseQuote(
      session,
      connection,
      createPublicApi(apiOrigin),
      kathaId,
    );
    setController(current);
    return () => current.dispose();
  }, [session, connection, apiOrigin, kathaId]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noop,
    controller?.getSnapshot ?? empty,
    empty,
  );
  if (!auth.session)
    return (
      <p className="mt-8" role="status">
        Connect and{" "}
        <Link className="text-link" href="/account">
          sign in with the buyer wallet
        </Link>{" "}
        to request a quote.
      </p>
    );
  const quote = state.quote;
  return (
    <section
      className="mt-10 max-w-reading"
      aria-labelledby="purchase-quote-title"
      aria-busy={state.status === "loading"}
    >
      <h2 id="purchase-quote-title" className="text-2xl">
        {kathaId}
      </h2>
      <p className="mt-3 text-sm text-muted">
        {auth.session.cluster === "devnet" ? "Devnet" : "Localnet"} · Katha test token ·
        No monetary value
      </p>
      <button
        type="button"
        className="button-primary mt-5"
        disabled={!controller || state.status === "loading"}
        onClick={() => void controller?.refresh()}
      >
        Refresh purchase quote
      </button>
      {state.status === "loading" && (
        <p role="status" className="mt-4">
          Checking current terms and purchase simulation…
        </p>
      )}
      {state.status === "unavailable" && (
        <p role="alert" className="mt-4">
          A purchase quote is unavailable. Check the active listing, buyer wallet,
          test-token funds and network, then refresh. Previous terms have been cleared.
        </p>
      )}
      {!quote && state.status !== "loading" && state.status !== "unavailable" && (
        <p className="mt-4">
          Request current terms before reviewing this artwork’s purchase.
        </p>
      )}
      {quote && state.artwork && (
        <>
          <p className="mt-6 text-lead">{state.artwork.title}</p>
          <p className="eyebrow mt-4">
            {quote.saleKind === "PRIMARY" ? "Primary sale" : "Secondary sale"}
          </p>
          <p className="mt-3 text-2xl">
            Total: {testTokenAmount(quote.price)} test tokens
          </p>
          <p className="mt-2 text-sm text-muted">
            {quote.price} base units · Six decimal places · Network SOL fees are
            additional.
          </p>
          <h3 className="mt-8 text-xl">Sale distribution</h3>
          <dl className="mt-4 space-y-4">
            {(
              [
                ["Seller proceeds", quote.seller, quote.distribution.sellerProceeds],
                [
                  "Artist proceeds",
                  quote.artistPayout,
                  quote.distribution.artistProceeds,
                ],
                ["Treasury commission", quote.treasury, quote.distribution.treasuryFee],
              ] as const
            ).map(([label, wallet, amount]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="mt-1">
                  {testTokenAmount(amount)} test tokens{" "}
                  <span className="text-sm text-muted">({amount} base units)</span>
                  <span className="mt-1 block break-all font-mono text-sm">
                    {wallet}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm">
            Platform commission: {quote.fees.platformCommissionBps} basis points.
            Secondary royalty: {quote.fees.secondaryRoyaltyBps} basis points. These are
            configured simulation settings; each deduction rounds down in base units.
          </p>
          <h3 className="mt-8 text-xl">Recipient wallet totals</h3>
          <p className="mt-3 text-sm text-muted">
            Roles can share a wallet. These merged amounts avoid counting a payment
            twice.
          </p>
          <ul className="mt-4 space-y-3">
            {quote.distribution.recipients.map((recipient) => (
              <li key={recipient.wallet}>
                <span className="block break-all font-mono text-sm">
                  {recipient.wallet}
                </span>
                {testTokenAmount(recipient.amount)} test tokens ({recipient.amount} base
                units)
              </li>
            ))}
          </ul>
          <h3 className="mt-8 text-xl">Terms and physical custody</h3>
          <dl className="mt-4 space-y-3">
            <div>
              <dt>Expected listing revision</dt>
              <dd>{quote.revision}</dd>
            </div>
            <div>
              <dt>Quote custody revision</dt>
              <dd>{quote.custodyRevision}</dd>
            </div>
            <div>
              <dt>Recorded physical custody</dt>
              <dd>{custodyLabels[state.artwork.custody.state]}</dd>
            </div>
            <div>
              <dt>Listing expiry (Unix seconds)</dt>
              <dd>{quote.expiresAt}</dd>
            </div>
            <div>
              <dt>Finalized observation slot</dt>
              <dd>{quote.observedSlot}</dd>
            </div>
            <div>
              <dt>Test-token mint</dt>
              <dd className="break-all font-mono text-sm">
                {quote.payment.paymentMint}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm">
            Custody is an independent recorded observation and may lag. A quote does not
            reserve the artwork, guarantee eligibility or prove payment. Delivery
            remains manually coordinated. Refresh terms before purchase; current
            ownership, inspection and listing eligibility must be rechecked.
          </p>
          <details className="mt-5">
            <summary>Review buyer and quote commitment</summary>
            <p className="mt-3 break-all font-mono text-sm">Buyer: {quote.buyer}</p>
            <p className="mt-3 break-all font-mono text-sm">
              Quote hash: {quote.quoteHash}
            </p>
          </details>
        </>
      )}
    </section>
  );
}
