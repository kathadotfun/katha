"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWalletConnection, useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { disconnectedWalletSnapshot } from "../lib/wallet-connection";
import {
  createCollectorAccount,
  lockedAccountSnapshot,
  type CollectorAccount,
} from "../lib/collector-account";
const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverWallet = () => disconnectedWalletSnapshot;
const serverAccount = () => lockedAccountSnapshot;
export function CollectorAccountPanel() {
  const session = useWalletSession();
  const connection = useWalletConnection();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverAuth,
    serverAuth,
  );
  const wallet = useSyncExternalStore(
    connection?.subscribe ?? emptySubscribe,
    connection?.getSnapshot ?? serverWallet,
    serverWallet,
  );
  const [account, setAccount] = useState<CollectorAccount | null>(null);
  useEffect(() => {
    if (!session) return;
    const controller = createCollectorAccount(session);
    setAccount(controller);
    return () => controller.dispose();
  }, [session]);
  useEffect(() => {
    if (auth.status === "signed-in") void account?.refresh();
  }, [account, auth.status, auth.session]);
  const state = useSyncExternalStore(
    account?.subscribe ?? emptySubscribe,
    account?.getSnapshot ?? serverAccount,
    serverAccount,
  );
  const connected = wallet.connected;
  const cluster = connection?.cluster;
  // Hide private results immediately even before an effect reacts to an identity change.
  const result =
    auth.session &&
    state.account &&
    state.account.session.walletAddress === auth.session.walletAddress &&
    state.account.session.walletId === auth.session.walletId &&
    state.account.session.cluster === auth.session.cluster &&
    state.account.session.expiresAt === auth.session.expiresAt
      ? state.account
      : null;
  return (
    <div className="mt-12 grid gap-12 lg:grid-cols-2">
      <section
        aria-labelledby="account-wallet-title"
        className="min-w-0 border-t border-line pt-6"
      >
        <h2 id="account-wallet-title" className="text-2xl">
          Wallet &amp; session
        </h2>
        <p className="mt-3 text-sm text-muted">
          {cluster
            ? cluster === "devnet"
              ? "Devnet · Test environment"
              : "Localnet · Test environment"
            : "Loading wallet connection…"}
        </p>
        {connected ? (
          <>
            <dl className="mt-6 space-y-5">
              <div>
                <dt className="eyebrow text-muted">Wallet</dt>
                <dd className="mt-1">{connected.walletName}</dd>
              </div>
              <div>
                <dt className="eyebrow text-muted">Public address</dt>
                <dd className="mt-2 break-all font-mono text-sm">
                  {connected.address}
                </dd>
              </div>
              <div>
                <dt className="eyebrow text-muted">Katha session</dt>
                <dd className="mt-1">
                  <span role="status">
                    {auth.status === "signed-in"
                      ? "Signed in"
                      : auth.status === "signing-in"
                        ? "Waiting for wallet approval…"
                        : "Not signed in"}
                  </span>
                </dd>
              </div>
              {auth.session && (
                <div>
                  <dt className="eyebrow text-muted">Session expires</dt>
                  <dd className="mt-1 break-all">
                    <time dateTime={auth.session.expiresAt}>
                      {auth.session.expiresAt}
                    </time>
                  </dd>
                </div>
              )}
            </dl>
            <div className="mt-6 flex flex-wrap gap-4">
              {auth.status === "signed-out" && connected.supportsMessageSigning && (
                <button
                  type="button"
                  className="button-primary"
                  disabled={!session}
                  onClick={() => void session?.signIn()}
                >
                  Sign in to Katha
                </button>
              )}
              {auth.status !== "signed-out" && (
                <button
                  type="button"
                  className="site-nav-link"
                  onClick={() => session?.signOut()}
                >
                  {auth.status === "signing-in" ? "Cancel sign-in" : "Sign out"}
                </button>
              )}
            </div>
            {!connected.supportsMessageSigning && (
              <p className="mt-4 text-muted">
                This wallet account cannot sign login messages. Choose a compatible
                account in the header.
              </p>
            )}
          </>
        ) : (
          <p role="status" className="mt-6">
            Connect your Solana wallet using “Connect wallet” in the header to begin.
          </p>
        )}
        <p className="mt-5 text-sm text-muted">
          Connecting shares your public address. Signing in approves a login message,
          not an artwork purchase.
        </p>
        {auth.error && (
          <p role="alert" className="mt-4">
            {auth.error}
          </p>
        )}
      </section>
      <section
        aria-labelledby="account-summary-title"
        aria-busy={state.status === "loading"}
        className="min-w-0 border-t border-line pt-6"
      >
        <h2 id="account-summary-title" className="text-2xl">
          Your collecting overview
        </h2>
        {!auth.session ? (
          <p role="status" className="mt-6">
            Sign in to see your published indexed artwork count.
          </p>
        ) : (
          <>
            {state.status === "loading" && (
              <div role="status" className="mt-6">
                <div aria-hidden="true" className="h-12 w-24 bg-line" />
                <p className="mt-3">Loading your account…</p>
              </div>
            )}
            {state.status === "unavailable" && (
              <p role="alert" className="mt-6">
                Your account could not be loaded. Check the API connection and try
                again.
              </p>
            )}
            {result && (
              <div className="mt-6">
                <p className="text-5xl font-serif">{result.indexedArtworkCount}</p>
                <p className="mt-2">Published indexed artworks</p>
                <p className="mt-3 text-sm text-muted">
                  {result.indexedArtworkCount === 0
                    ? "No published artworks are indexed for this wallet yet."
                    : "This count reflects the indexer’s published ownership records."}
                </p>
                <p className="mt-3 break-all text-sm text-muted">
                  Evaluated{" "}
                  <time dateTime={result.evaluatedAt}>{result.evaluatedAt}</time>
                </p>
              </div>
            )}
            <button
              type="button"
              className="site-nav-link mt-5"
              disabled={!account || state.status === "loading"}
              onClick={() => void account?.refresh()}
            >
              {state.status === "unavailable" ? "Try again" : "Refresh account"}
            </button>
          </>
        )}
        <p className="mt-5 text-sm text-muted">
          Indexing can lag behind Core ownership. This count is an observation, not a
          live wallet balance.
        </p>
        <Link
          href="/collection"
          className="text-link mt-5 inline-flex min-h-11 items-center"
        >
          View my collection
        </Link>
        <Link
          href="/explore"
          className="text-link mt-5 inline-flex min-h-11 items-center"
        >
          Explore Nepali art
        </Link>
      </section>
      <section
        aria-labelledby="account-payment-title"
        className="border-t border-line pt-6 lg:col-span-2"
      >
        <p className="eyebrow text-brand">Development simulation</p>
        <h2 id="account-payment-title" className="mt-3 text-2xl">
          Test-token payments
        </h2>
        <p className="mt-4 max-w-reading text-muted">
          Katha’s localnet and Devnet marketplace uses a configured six-decimal test
          token to demonstrate purchases and resale. It has no real-money value.
        </p>
        <p className="mt-3 max-w-reading text-sm text-muted">
          Token balances are not loaded on this page. Test payments do not represent
          production USDC or fiat settlement.
        </p>
      </section>
    </div>
  );
}
