"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  useWalletSession,
  useWalletConnection,
  useTransactionLifecycle,
} from "./wallet-provider";
import { TransactionReviewView } from "./transaction-review";
import { idleTransactionSnapshot } from "../lib/transaction-lifecycle";
import { signedOutSnapshot } from "../lib/wallet-session";
import { createPublicApi } from "../lib/public-api";
import {
  createPurchaseQuote,
  emptyPurchaseQuote,
  type PurchaseQuoteController,
} from "../lib/purchase-quote";
import {
  localDateTime,
  localTime,
  shortAddress,
  tokenAmount,
  unixSecondsIso,
} from "../lib/format";
import { signInHref } from "../lib/return-path";
import { Badge, Icon, Notice } from "./ui/status";

const noop = () => () => {};
const emptyAuth = () => signedOutSnapshot;
const empty = () => emptyPurchaseQuote;
const custodyText = {
  UNKNOWN: "Not recorded. Delivery is requested separately after purchase.",
  KATHA_HELD: "Held by Katha. Delivery is requested separately after purchase.",
  COLLECTOR_HELD:
    "With the current owner. Delivery is arranged separately after purchase.",
  IN_TRANSIT: "In transit. Delivery is arranged separately after purchase.",
};

export function PurchaseQuotePanel({
  kathaId,
  apiOrigin,
  artistName,
  summary,
}: {
  kathaId: string;
  apiOrigin: string;
  artistName: string | null;
  summary?: React.ReactNode;
}) {
  const session = useWalletSession(),
    connection = useWalletConnection(),
    transactions = useTransactionLifecycle();
  const tx = useSyncExternalStore(
    transactions?.subscribe ?? noop,
    transactions?.getSnapshot ?? (() => idleTransactionSnapshot),
    () => idleTransactionSnapshot,
  );
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
      transactions ?? undefined,
    );
    setController(current);
    return () => current.dispose();
  }, [session, connection, transactions, apiOrigin, kathaId]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noop,
    controller?.getSnapshot ?? empty,
    empty,
  );
  const purchaseTx =
    tx.operation?.kind === "PURCHASE_ARTWORK" && tx.operation.kathaId === kathaId;
  // Load current terms once signed in; never while a purchase is in flight.
  useEffect(() => {
    if (auth.status === "signed-in" && state.status === "locked" && tx.phase === "idle")
      void controller?.refresh();
  }, [auth.status, controller, state.status, tx.phase]);

  // Changed terms must be acknowledged before preparation: a quote never reserves.
  const seen = useRef<{ hash: string; price: string; expiresAt: string } | null>(null);
  const [changed, setChanged] = useState<{ hash: string; from: string } | null>(null);
  const quote = state.quote;
  useEffect(() => {
    if (!quote) return;
    const before = seen.current;
    if (
      before &&
      before.hash !== quote.quoteHash &&
      (before.price !== quote.price || before.expiresAt !== quote.expiresAt)
    )
      setChanged({ hash: quote.quoteHash, from: before.price });
    seen.current = {
      hash: quote.quoteHash,
      price: quote.price,
      expiresAt: quote.expiresAt,
    };
  }, [quote]);
  const needsAcknowledgement = changed !== null && changed.hash === quote?.quoteHash;

  if (!auth.session)
    return (
      <div className="mt-8 flex flex-wrap items-start gap-8">
        <div className="panel cut panel-empty" style={{ flex: "999 1 600px" }}>
          <p className="empty-title">Sign in to review this purchase</p>
          <p className="p max-w-xl">
            Purchase terms are prepared for a specific buyer wallet. Connect your wallet
            and sign in, then come back to review the exact total.
          </p>
          <Link
            className="btn btn-p cut-s mt-2"
            href={signInHref(`/art/${kathaId}/purchase`)}
          >
            Sign in
          </Link>
        </div>
        <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
          {summary}
        </aside>
      </div>
    );
  const complete =
    purchaseTx &&
    (tx.phase === "indexed" ||
      (tx.phase === "indexing-delay" && tx.purchaseOwnerConfirmed));
  const busy = !controller || state.status === "loading" || state.preparing;
  const locked = tx.signature !== null && tx.phase !== "failed";
  return (
    <>
      {needsAcknowledgement && quote && (
        <Notice tone="warn" icon="warning" role="alert" className="mt-7">
          <p>
            <strong>The terms changed since you last checked.</strong> The total is now{" "}
            {tokenAmount(quote.price)} Katha test token (it was{" "}
            {tokenAmount(changed.from)}), and the listing now expires{" "}
            {localDateTime(unixSecondsIso(quote.expiresAt))}. Review the updated terms
            below before preparing a transaction.
          </p>
          <button
            type="button"
            className="btn btn-o btn-sm self-start"
            onClick={() => setChanged(null)}
          >
            Use updated terms
          </button>
        </Notice>
      )}
      {state.status === "unavailable" &&
        (state.insufficientFunds ? (
          <Notice tone="err" icon="cancel" className="mt-7">
            <p>
              <strong>Not enough test token.</strong> Your wallet doesn&apos;t hold
              enough Katha test token for this total. Add test token to{" "}
              <span className="id">
                {shortAddress(auth.session?.walletAddress ?? "")}
              </span>
              , then refresh the terms. Nothing has been sent.
            </p>
            <button
              type="button"
              className="btn btn-o btn-sm self-start"
              onClick={() => void controller?.refresh()}
            >
              Refresh terms
            </button>
          </Notice>
        ) : (
          <Notice tone="err" icon="cancel" className="mt-7">
            <p>
              <strong>
                {state.preparationError
                  ? "Preparation didn't complete."
                  : "Purchase terms aren't available."}
              </strong>{" "}
              {state.preparationError ??
                "The listing may have sold, been cancelled or expired. Nothing was sent from your wallet."}
            </p>
            <Link className="btn btn-o btn-sm self-start" href={`/art/${kathaId}`}>
              Back to artwork record
            </Link>
          </Notice>
        ))}
      <div className="mt-8 flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-col gap-6" style={{ flex: "999 1 600px" }}>
          <section
            className="panel cut panel-lg"
            aria-labelledby="purchase-quote-title"
            aria-busy={state.status === "loading"}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
              <h2 id="purchase-quote-title" className="h3">
                Purchase terms
              </h2>
              <div className="flex items-center gap-3.5">
                {quote && (
                  <span className="xs mut">
                    Observed {localTime(unixSecondsIso(quote.chainTime))}
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn-o btn-sm"
                  disabled={busy || locked}
                  onClick={() => void controller?.refresh()}
                >
                  <Icon name="refresh" />
                  Refresh terms
                </button>
              </div>
            </div>
            {state.status === "loading" && (
              <p role="status" className="p mt-5">
                Checking current terms and purchase simulation…
              </p>
            )}
            {state.preparing && (
              <p role="status" className="p mt-5">
                Preparing the reviewed purchase…
              </p>
            )}
            {!quote && state.status === "locked" && !purchaseTx && (
              <p className="p mt-5">
                Fetch current terms before reviewing this purchase.
              </p>
            )}
            {!quote && purchaseTx && (
              <p className="p mt-5">
                These terms were used for the transaction below. Refresh to see the
                listing&apos;s current terms.
              </p>
            )}
            {quote && state.artwork && (
              <>
                <div className="mt-5 mb-2 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                  <p
                    className="serif m-0 font-semibold"
                    style={{ fontSize: "clamp(32px, 3.4vw, 44px)", lineHeight: 1.05 }}
                  >
                    {tokenAmount(quote.price)}
                  </p>
                  <p className="sm mut m-0">
                    Katha test token, exact total ({quote.price} base units). No
                    monetary value.
                  </p>
                </div>
                <dl className="mt-4 mb-0">
                  <div className="kv">
                    <dt>Sale</dt>
                    <dd>
                      {quote.saleKind === "PRIMARY" ? "Primary sale" : "Secondary sale"}
                    </dd>
                  </div>
                  <div className="kv">
                    <dt>Seller</dt>
                    <dd className="id">{quote.seller}</dd>
                  </div>
                  <div className="kv">
                    <dt>Your wallet</dt>
                    <dd className="id">{quote.buyer}</dd>
                  </div>
                  <div className="kv">
                    <dt>Payment token</dt>
                    <dd>
                      Katha test token (
                      {auth.session.cluster === "devnet" ? "Devnet" : "Localnet"}), mint{" "}
                      <span className="id">{quote.payment.paymentMint}</span>
                    </dd>
                  </div>
                  <div className="kv">
                    <dt>Listing expires</dt>
                    <dd>{localDateTime(unixSecondsIso(quote.expiresAt))}</dd>
                  </div>
                  <div className="kv">
                    <dt>Recorded custody</dt>
                    <dd>{custodyText[state.artwork.custody.state]}</dd>
                  </div>
                </dl>
                <h3 className="serif mt-7 mb-2 text-[19px] font-semibold text-madder">
                  Where the total goes
                </h3>
                <div
                  className="overflow-x-auto"
                  role="region"
                  aria-label="Distribution, scrolls sideways"
                  tabIndex={0}
                >
                  <table className="tbl tbl-compact">
                    <thead>
                      <tr>
                        <th scope="col">Recipient</th>
                        <th scope="col">Address</th>
                        <th scope="col" className="num">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          [
                            `Artist proceeds${artistName ? `, ${artistName}` : ""}`,
                            quote.artistPayout,
                            quote.distribution.artistProceeds,
                          ],
                          [
                            "Seller proceeds",
                            quote.seller,
                            quote.distribution.sellerProceeds,
                          ],
                          [
                            "Platform commission, Katha",
                            quote.treasury,
                            quote.distribution.treasuryFee,
                          ],
                        ] as const
                      ).map(([label, wallet, amount]) => (
                        <tr key={label}>
                          <td>{label}</td>
                          <td className="id font-medium">{wallet}</td>
                          <td className="num">{tokenAmount(amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="font-semibold">Total</td>
                        <td />
                        <td className="num font-semibold">
                          {tokenAmount(quote.price)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="xs mut mt-3 mb-0">
                  Amounts come from Katha for this listing and reflect current
                  development settings ({quote.fees.platformCommissionBps} basis points
                  platform commission, {quote.fees.secondaryRoyaltyBps} basis points
                  secondary royalty, each rounded down in base units), not final
                  commercial terms. Your wallet shows the Solana network fee separately.
                </p>
                <details className="more mt-2">
                  <summary>Exact recipient totals and quote commitment</summary>
                  <p className="xs mut mt-1 mb-2">
                    Roles can share a wallet; these merged totals avoid counting a
                    payment twice.
                  </p>
                  <ul className="m-0 list-none p-0">
                    {quote.distribution.recipients.map((recipient) => (
                      <li key={recipient.wallet} className="kv">
                        <span className="id">{recipient.wallet}</span>
                        <span>
                          {tokenAmount(recipient.amount)} ({recipient.amount} base
                          units)
                        </span>
                      </li>
                    ))}
                  </ul>
                  <dl className="m-0">
                    <div className="kv">
                      <dt>Listing revision</dt>
                      <dd>{quote.revision}</dd>
                    </div>
                    <div className="kv">
                      <dt>Custody revision</dt>
                      <dd>{quote.custodyRevision}</dd>
                    </div>
                    <div className="kv">
                      <dt>Observed slot</dt>
                      <dd className="id">{quote.observedSlot}</dd>
                    </div>
                    <div className="kv">
                      <dt>Quote hash</dt>
                      <dd className="id">{quote.quoteHash}</dd>
                    </div>
                  </dl>
                </details>
              </>
            )}
          </section>

          {purchaseTx ? (
            <TransactionReviewView
              state={tx}
              id="purchase-transaction-title"
              title="Transaction"
              onApprove={() => void transactions?.approveAndSend()}
              onCheck={() => void transactions?.checkConfirmation()}
              onCancel={() => transactions?.cancel()}
            />
          ) : (
            <section
              className="panel cut panel-lg"
              aria-labelledby="purchase-transaction-title"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                <h2 id="purchase-transaction-title" className="h3">
                  Transaction
                </h2>
                <Badge tone="neu">Not started</Badge>
              </div>
              <p className="p mt-4">
                Preparing rechecks these terms and simulates the purchase. You&apos;ll
                review the exact transaction, then approve it explicitly in your wallet.
              </p>
              <button
                className="btn btn-p cut-s mt-5"
                type="button"
                disabled={!controller?.canPrepare() || needsAcknowledgement}
                onClick={() => void controller?.prepare()}
              >
                Prepare transaction
              </button>
            </section>
          )}

          {complete && (
            <section className="red-panel cut dk" aria-labelledby="purchase-done-title">
              <h2
                id="purchase-done-title"
                className="serif m-0 text-[28px] leading-[1.15] font-semibold"
              >
                The artwork is yours
              </h2>
              <p className="m-0 max-w-[38rem]">
                The digital asset is in your wallet
                {tx.phase === "indexed"
                  ? " and the sale is in the artwork's history."
                  : ". The sale will appear in the artwork's history once indexing catches up."}{" "}
                The painting&apos;s custody hasn&apos;t changed; ask for delivery
                whenever you&apos;re ready, or leave it in Katha&apos;s care.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
                <Link
                  className="btn btn-l cut-s"
                  href={`/collection/${kathaId}/delivery`}
                >
                  Request delivery
                </Link>
                <Link className="lnk-d" href="/collection">
                  View my collection
                </Link>
              </div>
            </section>
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
          {summary}
          <div className="panel cut-s flex flex-col gap-2 p-[18px]">
            <p className="sm m-0">
              <strong>A quote doesn&apos;t reserve the work.</strong> Someone else can
              buy it until your transaction is finalized.
            </p>
            <p className="sm m-0">
              <strong>Buying isn&apos;t delivery.</strong> A confirmed purchase moves
              the digital asset. Shipping the painting is arranged separately.
            </p>
            <p className="sm m-0">
              <strong>Copyright isn&apos;t included.</strong> Attribution stays with
              {artistName ? ` ${artistName}` : " the artist"}.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
