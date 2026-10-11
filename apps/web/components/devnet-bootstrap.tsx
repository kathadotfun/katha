"use client";

import { useEffect, useRef, useState } from "react";
import {
  createClient,
  generateKeyPairSigner,
  type TransactionPartialSigner,
} from "@solana/kit";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { devnetBootstrapSteps, type DevnetBootstrapStep } from "@katha/shared";
import {
  createDevnetBootstrapClient,
  publicBootstrapFailure,
  type DevnetBootstrapPrepared,
} from "../lib/devnet-bootstrap";

function operatorWallet() {
  return createClient().use(
    walletSigner({ chain: "solana:devnet", storage: null, autoConnect: false }),
  );
}
const example = JSON.stringify(
  {
    cluster: "devnet",
    operator: "REPLACE_WITH_PUBLIC_OPERATOR",
    collection: "GENERATE_IN_THIS_TAB",
    collectionUri: "https://example.invalid/katha-devnet-collection.json",
    registrationAuthority: "REPLACE_WITH_PUBLIC_ADDRESS",
    verifierAuthority: "REPLACE_WITH_PUBLIC_ADDRESS",
    custodyAuthority: "REPLACE_WITH_PUBLIC_ADDRESS",
    treasury: "REPLACE_WITH_PUBLIC_ADDRESS",
    paymentMint: "REPLACE_WITH_PUBLIC_TEST_MINT",
  },
  null,
  2,
);

export function DevnetBootstrapControls({ rpcUrl }: { rpcUrl: string }) {
  const [wallet, setWallet] = useState<ReturnType<typeof operatorWallet> | null>(null);
  const [revision, setRevision] = useState(0);
  const [text, setText] = useState(example);
  const [step, setStep] = useState<DevnetBootstrapStep>("collection");
  const [kathaId, setKathaId] = useState("");
  const [payout, setPayout] = useState("");
  const [prepared, setPrepared] = useState<DevnetBootstrapPrepared | null>(null);
  const [retained, setRetained] = useState<string | null>(null);
  const [status, setStatus] = useState<"UNKNOWN" | "FAILED" | "FINALIZED" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<string[]>([]);
  const collection = useRef<TransactionPartialSigner | undefined>(undefined);
  const active = useRef(true);
  const generation = useRef(0);
  const signed = useRef<string | null>(null);
  useEffect(() => {
    active.current = true;
    const current = operatorWallet();
    setWallet(current);
    const unsubscribe = current.wallet.subscribe(() => {
      generation.current++;
      setRevision((value) => value + 1);
      if (!signed.current) {
        setPrepared(null);
        setConfirmed(false);
      }
    });
    return () => {
      active.current = false;
      generation.current++;
      unsubscribe();
      current[Symbol.dispose]();
      collection.current = undefined;
    };
  }, []);
  void revision;
  const state = wallet?.wallet.getState();
  const locked = busy || Boolean(prepared) || Boolean(retained);
  const terminal = status === "FAILED" || status === "FINALIZED";
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      if (active.current)
        setError(
          signed.current
            ? "Outcome uncertain. Keep the retained signature and check it again; do not submit a replacement."
            : publicBootstrapFailure(failure),
        );
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section
      className="panel cut panel-lg mt-8 flex flex-col gap-4"
      aria-labelledby="bootstrap-controls"
    >
      <h2 id="bootstrap-controls" className="h2 h2-ops">
        Devnet operator controls
      </h2>
      <p className="p max-w-reading">
        This utility connects its own operator wallet. It does not use the header
        sign-in session. Use the same bootstrap operator as both program upgrade
        authorities and Registry platform authority. Role wallets may be different.
        Every write requires separate review and approval.
      </p>
      <p className="sm m-0">
        RPC <span className="id">{rpcUrl}</span>
      </p>
      <p className="xs mut m-0">Approval diagnostics v2 · 20-second timeout</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {state?.connected ? (
          <>
            <p className="id m-0">
              {state.connected.wallet.name}: {state.connected.account.address}
            </p>
            <button
              type="button"
              className="lnk"
              disabled={locked}
              onClick={() => void action(() => wallet!.wallet.disconnect())}
            >
              Disconnect operator
            </button>
          </>
        ) : (
          state?.wallets.map((available, index) => (
            <button
              key={`${available.name}:${index}`}
              type="button"
              className="lnk"
              disabled={locked}
              onClick={() =>
                void action(async () => {
                  await wallet!.wallet.connect(available);
                })
              }
            >
              Connect {available.name}
            </button>
          ))
        )}
      </div>
      <div className="flex flex-col gap-4">
        <label className="lbl" htmlFor="bootstrap-public-input">
          Public bootstrap JSON (addresses only; no keys, tokens or RPC credentials)
        </label>
        <textarea
          id="bootstrap-public-input"
          rows={18}
          value={text}
          disabled={locked}
          onChange={(event) => setText(event.target.value)}
          className="inp xs font-mono"
        />
        <button
          type="button"
          className="lnk self-start"
          disabled={locked || !state?.connected}
          onClick={() =>
            void action(async () => {
              const value: unknown = JSON.parse(text);
              if (!value || typeof value !== "object" || Array.isArray(value))
                throw new Error("Invalid public object");
              collection.current = await generateKeyPairSigner();
              setText(
                JSON.stringify(
                  {
                    ...value,
                    operator: state!.connected!.account.address,
                    collection: collection.current.address,
                  },
                  null,
                  2,
                ),
              );
            })
          }
        >
          Generate temporary Devnet collection address
        </button>
        <p className="help">
          The fresh collection signer exists only in this tab. Save its public address
          and successful receipt. After finalized collection creation, no collection
          private key is needed for Registry initialization.
        </p>
        <label htmlFor="bootstrap-step" className="lbl">
          Operation
        </label>
        <select
          id="bootstrap-step"
          className="inp"
          value={step}
          disabled={locked}
          onChange={(event) => setStep(event.target.value as DevnetBootstrapStep)}
        >
          {devnetBootstrapSteps.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {step === "sale-terms" && (
          <>
            <label htmlFor="bootstrap-artwork" className="lbl">
              Registered permanent Katha ID
            </label>
            <input
              id="bootstrap-artwork"
              className="inp"
              value={kathaId}
              disabled={locked}
              onChange={(event) => setKathaId(event.target.value)}
            />
            <label htmlFor="bootstrap-payout" className="lbl">
              Artist-approved public payout wallet (immutable once initialized)
            </label>
            <input
              id="bootstrap-payout"
              className="inp id"
              value={payout}
              disabled={locked}
              onChange={(event) => setPayout(event.target.value)}
            />
          </>
        )}
        <button
          type="button"
          className="btn btn-p cut-s self-start"
          disabled={locked || !state?.connected}
          onClick={() =>
            void action(async () => {
              const current = generation.current;
              const result = await createDevnetBootstrapClient(
                wallet!.wallet,
                rpcUrl,
              ).prepare(
                step,
                JSON.parse(text),
                step === "sale-terms" ? { kathaId, artistPayout: payout } : undefined,
                collection.current,
              );
              if (active.current && current === generation.current) {
                setPrepared(result);
                setConfirmed(false);
              }
            })
          }
        >
          Prepare and simulate
        </button>
      </div>
      {prepared && (
        <div className="inset flex min-w-0 flex-col gap-3">
          <h3 className="h3">Exact public operation review</h3>
          <pre className="xs max-h-128 overflow-auto whitespace-pre-wrap wrap-anywhere">
            {prepared.summary}
          </pre>
          <label className="chk">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || Boolean(retained)}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I reviewed this Devnet operation, authorities, recipient/payout, test
              mint, fees and additional rent. Collection metadata is approved for public
              storage. Payout authorization has been checked where applicable.
            </span>
          </label>
          <button
            type="button"
            className="btn btn-p cut-s self-start"
            disabled={busy || Boolean(retained) || !confirmed}
            onClick={() =>
              void action(async () => {
                await createDevnetBootstrapClient(wallet!.wallet, rpcUrl).approve(
                  prepared,
                  (value) => {
                    signed.current = value;
                    if (active.current) {
                      setRetained(value);
                      setStatus("UNKNOWN");
                      setReceipts((items) => [...items, `${prepared.step}: ${value}`]);
                    }
                  },
                );
                if (active.current && signed.current)
                  setStatus(
                    await createDevnetBootstrapClient(wallet!.wallet, rpcUrl).check(
                      signed.current,
                    ),
                  );
              })
            }
          >
            Approve in wallet and submit
          </button>
          {!retained && (
            <button
              type="button"
              className="lnk self-start"
              disabled={busy}
              onClick={() => {
                setPrepared(null);
                setConfirmed(false);
              }}
            >
              Discard unsigned review
            </button>
          )}
        </div>
      )}
      {retained && (
        <div className="inset flex flex-col gap-2">
          <p className="sm m-0">
            Saved transaction <span className="id">{retained}</span>
          </p>
          <p className="p sm" role="status">
            Receipt: {status ?? "UNKNOWN"}. Save this public signature before leaving
            the page.
          </p>
          <button
            type="button"
            className="lnk self-start"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await createDevnetBootstrapClient(
                  wallet!.wallet,
                  rpcUrl,
                ).check(retained);
                if (active.current) setStatus(result);
              })
            }
          >
            Check this signature again
          </button>
          {terminal && (
            <button
              type="button"
              className="lnk self-start"
              disabled={busy}
              onClick={() => {
                signed.current = null;
                setRetained(null);
                setStatus(null);
                setPrepared(null);
                setConfirmed(false);
              }}
            >
              Start next operation (keep receipt)
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="ferr" role="alert">
          {error}
        </p>
      )}
      {receipts.length > 0 && (
        <details className="more">
          <summary>Public receipt record for this tab</summary>
          <pre className="xs inset mt-2 whitespace-pre-wrap wrap-anywhere">
            {receipts.join("\n")}
          </pre>
        </details>
      )}
    </section>
  );
}
