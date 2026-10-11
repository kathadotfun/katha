"use client";

import { useEffect, useRef, useState } from "react";
import type {
  WalletConnection,
  WalletConnectionSnapshot,
} from "../lib/wallet-connection";
import { shortAddress } from "../lib/format";
import { Icon } from "./ui/status";

// Native modal dialog: the browser supplies focus containment, Escape and inert
// background. Wallet handles never reach this view; only public names and addresses.
export function WalletChooser({
  open,
  onClose,
  connection,
  wallet,
}: {
  open: boolean;
  onClose: () => void;
  connection: WalletConnection | null;
  wallet: WalletConnectionSnapshot;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const busy = ["pending", "connecting", "disconnecting", "reconnecting"].includes(
    wallet.status,
  );
  const connected = wallet.connected;
  async function connect(id: string) {
    setError(null);
    try {
      await connection?.connect(id);
      onClose();
    } catch {
      setError("The wallet request wasn't completed. Check your wallet and try again.");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="dialog cut"
      aria-labelledby="wallet-chooser-title"
      onClose={() => {
        setError(null);
        onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="wallet-chooser-title" className="h3">
            Choose a wallet
          </h2>
          <p className="p sm">Wallets found in this browser.</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {busy && (
        <p role="status" className="p sm m-0">
          {wallet.status === "pending"
            ? "Looking for wallets…"
            : "Waiting for your wallet…"}
        </p>
      )}
      {!busy && wallet.wallets.length === 0 && (
        <p className="p m-0">
          No compatible Solana wallet found. Open Katha in a browser with a Wallet
          Standard wallet for this network.
        </p>
      )}
      {wallet.wallets.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {wallet.wallets.map((item) => {
            const current = connected?.walletId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="wallet cut-s"
                  disabled={busy || current}
                  aria-label={
                    current ? `${item.name}, connected` : `Connect ${item.name}`
                  }
                  onClick={() => void connect(item.id)}
                >
                  {item.name}
                  <span className="xs mut font-medium">
                    {current ? "Connected" : "Detected"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {connected && connected.accounts.length > 1 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="lbl mb-2">Accounts in {connected.walletName}</legend>
          {connected.accounts.map((value) => (
            <button
              key={value}
              type="button"
              className="wallet cut-s"
              disabled={busy}
              aria-pressed={value === connected.address}
              onClick={() => {
                setError(null);
                try {
                  connection?.selectAccount(value);
                  onClose();
                } catch {
                  setError("That wallet account is no longer available.");
                }
              }}
            >
              <span className="id min-w-0">{shortAddress(value)}</span>
              <span className="xs mut font-medium">
                {value === connected.address ? "In use" : "Switch"}
              </span>
            </button>
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="ferr">
          {error}
        </p>
      )}
      <p className="xs mut m-0">
        {connection?.cluster === "devnet"
          ? "Katha currently uses Solana Devnet. Switch your wallet to Devnet before connecting."
          : "Katha is running on a local Solana network. Point your wallet at this network before connecting."}
      </p>
    </dialog>
  );
}
