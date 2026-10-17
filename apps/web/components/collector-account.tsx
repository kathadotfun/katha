"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWalletConnection, useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import { disconnectedWalletSnapshot } from "../lib/wallet-connection";
import {
  createCollectorAccount,
  lockedAccountSnapshot,
  type CollectorAccount,
} from "../lib/collector-account";
import { localDateTime, localTime, shortAddress } from "../lib/format";
import { WalletChooser } from "./wallet-chooser";
import { Badge, Icon, Notice } from "./ui/status";
import { CopyButton } from "./ui/copy-button";

const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverWallet = () => disconnectedWalletSnapshot;
const serverAccount = () => lockedAccountSnapshot;

type Ended =
  { kind: "expired"; at: string } | { kind: "changed"; from: string; to: string };

export function CollectorAccountPanel({ next }: { next?: string | null }) {
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
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const previous = useRef<{ address: string; expiresAt: string } | null>(null);
  const userSignedOut = useRef(false);
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
  // The session controller clears authority itself; this only explains why.
  useEffect(() => {
    if (auth.session) {
      previous.current = {
        address: auth.session.walletAddress,
        expiresAt: auth.session.expiresAt,
      };
      userSignedOut.current = false;
      setEnded(null);
      return;
    }
    const before = previous.current;
    if (!before) return;
    previous.current = null;
    if (userSignedOut.current) {
      userSignedOut.current = false;
      return;
    }
    if (connected && connected.address !== before.address)
      setEnded({ kind: "changed", from: before.address, to: connected.address });
    else if (Date.parse(before.expiresAt) <= Date.now())
      setEnded({ kind: "expired", at: before.expiresAt });
  }, [auth.session, connected]);

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
  const busy = ["pending", "connecting", "disconnecting", "reconnecting"].includes(
    wallet.status,
  );
  const network =
    connection?.cluster === "devnet" ? "Solana Devnet" : "a local Solana network";
  const signedIn = auth.status === "signed-in" && auth.session && connected;
  const waiting = auth.status === "signing-in";
  function signOut() {
    userSignedOut.current = true;
    session?.signOut();
  }
  async function disconnect() {
    setError(null);
    userSignedOut.current = true;
    try {
      await connection?.disconnect();
    } catch {
      setError("The wallet request wasn't completed. Check your wallet and try again.");
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3.5">
        <p className="kick">Account</p>
        <h1 className="h1">{signedIn ? "Your account" : "Sign in with your wallet"}</h1>
        <p className="p">Katha never holds your keys.</p>
      </div>
      {ended?.kind === "expired" && (
        <Notice tone="warn" icon="clock" role="alert" className="mt-8">
          <p>
            <strong>Your session expired at {localTime(ended.at)}.</strong> Private
            details like delivery requests were hidden. Sign in again to see them.
          </p>
        </Notice>
      )}
      {ended?.kind === "changed" && (
        <Notice tone="info" role="alert" className="mt-8">
          <p>
            <strong>Your wallet switched accounts.</strong> You&apos;re signed out of{" "}
            {shortAddress(ended.from)} and its private details were cleared. Sign in to
            use {shortAddress(ended.to)}.
          </p>
        </Notice>
      )}
      {auth.error && (
        <Notice tone="err" className="mt-8">
          <p>{auth.error}</p>
        </Notice>
      )}
      {error && (
        <Notice tone="err" className="mt-8">
          <p>{error}</p>
        </Notice>
      )}
      <div className="account-layout">
        <section
          aria-labelledby="account-wallet-title"
          className="panel cut min-w-0"
          style={{ padding: "clamp(24px, 3.2vw, 40px)" }}
        >
          {signedIn ? (
            <div className="flex flex-col gap-[18px]">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
                <h2 id="account-wallet-title" className="h3">
                  Signed in
                </h2>
                <Badge tone="ok" role="status">
                  Connected and signed in
                </Badge>
              </div>
              <dl className="m-0">
                <div className="kv">
                  <dt>Wallet</dt>
                  <dd>{connected.walletName}</dd>
                </div>
                <div className="kv">
                  <dt>Public address</dt>
                  <dd className="id">
                    {connected.address}
                    <CopyButton value={connected.address} label="Copy public address" />
                  </dd>
                </div>
                <div className="kv">
                  <dt>Network</dt>
                  <dd>
                    {connection?.cluster === "devnet" ? "Solana Devnet" : "Localnet"}
                  </dd>
                </div>
                <div className="kv">
                  <dt>Wallet connection</dt>
                  <dd>Connected</dd>
                </div>
                <div className="kv">
                  <dt>Katha sign-in</dt>
                  <dd>
                    Signed in. Session expires{" "}
                    <time dateTime={auth.session!.expiresAt}>
                      {localDateTime(auth.session!.expiresAt)}
                    </time>
                  </dd>
                </div>
                <div className="kv">
                  <dt>Collection</dt>
                  <dd aria-busy={state.status === "loading"}>
                    {result ? (
                      <>
                        {result.indexedArtworkCount}{" "}
                        {result.indexedArtworkCount === 1 ? "artwork" : "artworks"}{" "}
                        indexed, as of{" "}
                        <time dateTime={result.evaluatedAt}>
                          {localTime(result.evaluatedAt)}
                        </time>
                      </>
                    ) : state.status === "unavailable" ? (
                      <span role="alert">
                        Your collection count couldn&apos;t load.{" "}
                        <button
                          type="button"
                          className="lnk"
                          onClick={() => void account?.refresh()}
                        >
                          Try again
                        </button>
                      </span>
                    ) : (
                      <span role="status">Loading your collection count…</span>
                    )}
                  </dd>
                </div>
              </dl>
              <p className="xs mut m-0">
                The count is Katha&apos;s indexed observation of published works, not a
                live wallet balance. Token balances aren&apos;t shown here.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
                {next ? (
                  <Link className="btn btn-p cut-s" href={next}>
                    Continue where you left off
                  </Link>
                ) : (
                  <Link className="btn btn-p cut-s" href="/collection">
                    View my collection
                  </Link>
                )}
                <button
                  type="button"
                  className="btn btn-o"
                  disabled={busy}
                  onClick={() => setChoosing(true)}
                >
                  Change account
                </button>
                <button type="button" className="lnk ml-2" onClick={signOut}>
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <span className="ibox">
                <Icon name={waiting ? "clock" : "lock"} size={20} />
              </span>
              {connected && (
                <span className="chip mt-2 self-start">
                  {shortAddress(connected.address)}
                </span>
              )}
              <h2 id="account-wallet-title" className="h2 mt-1.5">
                {waiting
                  ? "Waiting for your wallet"
                  : connected
                    ? "Prove this wallet is yours"
                    : "Connect a Solana wallet"}
              </h2>
              <p className="p sm">
                {waiting && connected
                  ? `Approve the sign-in message in ${connected.walletName}. It only proves this address is yours.`
                  : connected
                    ? "Sign a message. It’s free and doesn’t send a transaction."
                    : "Connecting shares your public address so you can see your collection, buy, list or request delivery."}
              </p>
              {connected && (
                <p className="xs m-0">
                  {connected.walletName} on {network}. Connection and sign-in are
                  separate steps.
                </p>
              )}
              {connected && !connected.supportsMessageSigning && (
                <Notice tone="warn">
                  <p>
                    This wallet account can&apos;t sign messages, so it can&apos;t sign
                    in. Choose another account or wallet.
                  </p>
                </Notice>
              )}
              {connected && !connected.supportsV0 && !connected.supportsV1 && (
                <p className="p sm">
                  This account doesn&apos;t support versioned Solana transactions, so it
                  can&apos;t approve purchases or listings.
                </p>
              )}
              <div className="stack mt-3" style={{ gap: 10 }}>
                {!connected ? (
                  <button
                    type="button"
                    className="btn btn-p btn-w"
                    disabled={!connection || busy}
                    onClick={() => setChoosing(true)}
                  >
                    {busy ? "Waiting for wallet…" : "Connect wallet"}
                  </button>
                ) : waiting ? (
                  <>
                    <Badge tone="info" marker={false} className="wait" role="status">
                      Waiting for {connected.walletName}
                    </Badge>
                    <button type="button" className="btn btn-g" onClick={signOut}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {connected.supportsMessageSigning && (
                      <button
                        type="button"
                        className="btn btn-p btn-w"
                        disabled={!session || busy}
                        onClick={() => void session?.signIn()}
                      >
                        {ended?.kind === "changed"
                          ? `Sign in as ${shortAddress(connected.address)}`
                          : "Sign in with wallet"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-g"
                      disabled={busy}
                      onClick={() => void disconnect()}
                    >
                      Disconnect
                    </button>
                    <button
                      type="button"
                      className="lnk self-center"
                      disabled={busy}
                      onClick={() => setChoosing(true)}
                    >
                      Change account
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
        <details className="more">
          <summary>About wallet sign-in</summary>
          <p className="p sm">
            Connecting shares your public address. Signing in proves that it is yours
            with a free message signature and unlocks private requests. Signing out, an
            expired session or a wallet account change hides those private details
            immediately.
          </p>
        </details>
      </div>
      <WalletChooser
        open={choosing}
        onClose={() => setChoosing(false)}
        connection={connection}
        wallet={wallet}
      />
    </>
  );
}
