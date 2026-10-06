"use client";

import { TransactionReview } from "./transaction-review";
import { useState, useSyncExternalStore } from "react";
import { disconnectedWalletSnapshot } from "../lib/wallet-connection";
import { signedOutSnapshot } from "../lib/wallet-session";
import { useWalletConnection, useWalletSession } from "./wallet-provider";
const emptySubscribe = () => () => {};
const serverSessionSnapshot = () => signedOutSnapshot;
const serverSnapshot = () => disconnectedWalletSnapshot;

export function WalletControl() {
  const connection = useWalletConnection();
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverSessionSnapshot,
    serverSessionSnapshot,
  );
  const state = useSyncExternalStore(
    connection?.subscribe ?? emptySubscribe,
    connection?.getSnapshot ?? serverSnapshot,
    serverSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = ["pending", "connecting", "disconnecting", "reconnecting"].includes(
    state.status,
  );
  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch {
      setError(
        "The wallet request was not completed. Check your wallet and try again.",
      );
    }
  }
  return (
    <div className="min-w-0 w-full sm:w-auto">
      <button
        type="button"
        className="site-nav-link"
        aria-expanded={open}
        aria-controls="wallet-connection-panel"
        onClick={() => setOpen(!open)}
      >
        {state.connected ? "Wallet connected" : "Connect wallet"}
      </button>
      {open && (
        <section
          id="wallet-connection-panel"
          aria-labelledby="wallet-connection-title"
          className="mt-4 max-w-reading border-t border-line py-4"
        >
          <h2 id="wallet-connection-title" className="text-2xl">
            Your Solana wallet
          </h2>
          <p className="mt-3 text-sm text-muted">
            Connecting shares your public address. It does not sign you in or approve a
            transaction.
          </p>
          <p className="mt-3 text-sm">
            Network: {connection?.cluster === "devnet" ? "Devnet" : "Localnet"} · Test
            environment
          </p>
          {busy && (
            <p role="status" className="mt-3">
              {state.status === "pending"
                ? "Looking for wallets…"
                : "Waiting for your wallet…"}
            </p>
          )}
          {state.connected ? (
            <div className="mt-4">
              <p>{state.connected.walletName}</p>
              <p className="mt-2 break-all font-mono text-sm">
                {state.connected.address}
              </p>
              {state.connected.accounts.length > 1 && (
                <label className="mt-4 block">
                  Wallet account
                  <select
                    className="mt-2 block w-full bg-surface p-2"
                    value={state.connected.address}
                    disabled={busy}
                    onChange={(event) => {
                      setError(null);
                      try {
                        connection?.selectAccount(event.target.value);
                      } catch {
                        setError("That wallet account is no longer available.");
                      }
                    }}
                  >
                    {state.connected.accounts.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!state.connected.supportsV0 && !state.connected.supportsV1 && (
                <p className="mt-3 text-sm text-muted">
                  This account does not support versioned Solana transactions.
                </p>
              )}
              <p role="status" className="mt-4">
                {auth.status === "signed-in"
                  ? "Signed in to Katha"
                  : auth.status === "signing-in"
                    ? "Waiting for sign-in approval…"
                    : "Not signed in"}
              </p>
              {auth.session && (
                <p className="mt-2 text-sm">
                  Session expires {new Date(auth.session.expiresAt).toISOString()}
                </p>
              )}
              {auth.status === "signed-out" &&
                state.connected.supportsMessageSigning && (
                  <button
                    type="button"
                    className="text-link mt-4 mr-4"
                    disabled={busy || !session}
                    onClick={() => void session?.signIn()}
                  >
                    Sign in to Katha
                  </button>
                )}
              {auth.status !== "signed-out" && (
                <button
                  type="button"
                  className="text-link mt-4 mr-4"
                  onClick={() => session?.signOut()}
                >
                  {auth.status === "signing-in" ? "Cancel sign-in" : "Sign out"}
                </button>
              )}
              {!state.connected.supportsMessageSigning && (
                <p className="mt-3 text-sm text-muted">
                  This account cannot sign sign-in messages.
                </p>
              )}
              <button
                type="button"
                className="text-link mt-4"
                disabled={busy}
                onClick={() => connection && void act(() => connection.disconnect())}
              >
                Disconnect wallet
              </button>
            </div>
          ) : !busy && state.wallets.length === 0 ? (
            <p className="mt-4 text-muted">
              No compatible Solana wallet found. Open Katha in a browser with a Wallet
              Standard wallet for this network.
            </p>
          ) : null}
          {!state.connected && state.wallets.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-4">
              {state.wallets.map((wallet) => (
                <li key={wallet.id}>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() =>
                      connection && void act(() => connection.connect(wallet.id))
                    }
                  >
                    Connect {wallet.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <TransactionReview />
          {auth.error && (
            <p role="alert" className="mt-4 text-sm">
              {auth.error}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
