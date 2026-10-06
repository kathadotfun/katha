"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { WalletSession } from "@katha/shared";
import {
  createBrowserWalletConnection,
  type WalletConnection,
} from "../lib/wallet-connection";
import {
  createWalletSession,
  type WalletSessionController,
} from "../lib/wallet-session";
import { createWalletSessionApi } from "../lib/wallet-session-api";
import {
  createTransactionLifecycle,
  type TransactionLifecycle,
} from "../lib/transaction-lifecycle";
import { createTransactionRpc } from "../lib/transaction-rpc";
import { createPublicApi } from "../lib/public-api";

type Runtime = Readonly<{
  connection: WalletConnection | null;
  session: WalletSessionController | null;
  transactions: TransactionLifecycle | null;
}>;
const emptyRuntime: Runtime = { connection: null, session: null, transactions: null };
let runtime = emptyRuntime;
const listeners = new Set<() => void>();
function publish(value: Runtime) {
  runtime = value;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => runtime;
const getServerSnapshot = () => emptyRuntime;
function useRuntime() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// The persistent header owns one browser runtime. Sibling admin views subscribe
// without putting streamed server pages inside a rerendering client provider.
// Server renders always see the empty snapshot; no bearer token is exposed here.
export function WalletProvider({
  children,
  cluster,
  apiOrigin,
  appOrigin,
  rpcUrl,
}: {
  children: React.ReactNode;
  cluster: WalletSession["cluster"];
  apiOrigin: string;
  appOrigin: string;
  rpcUrl: string;
}) {
  useEffect(() => {
    const current = createBrowserWalletConnection(cluster);
    const auth = createWalletSession(
      current.boundary,
      createWalletSessionApi(apiOrigin),
      appOrigin,
    );
    const flow = createTransactionLifecycle(
      current.boundary,
      auth,
      createTransactionRpc(cluster, rpcUrl),
      (id, signal) =>
        createPublicApi(apiOrigin).provenance(id, { limit: "100" }, { signal }),
      async (operation, signature, signal) => {
        if (operation.kind === "RECORD_CONDITION") {
          const page = await auth.readCondition(operation.kathaId, signal);
          return (
            page.attestation.receipt?.status === "FINALIZED" &&
            page.attestation.receipt.signature === signature &&
            page.attestation.receipt.indexed
          );
        }
        if (operation.kind === "VERIFY_ARTWORK") {
          const review = await auth.readVerification(operation.kathaId, signal);
          return (
            review.verification.receipt?.status === "FINALIZED" &&
            review.verification.receipt.signature === signature &&
            review.verification.receipt.indexed
          );
        }
        if (operation.kind === "REGISTER_ARTWORK") {
          const review = await auth.readRegistration(operation.kathaId, signal);
          return (
            review.registration.receipt?.status === "FINALIZED" &&
            review.registration.receipt.signature === signature &&
            review.registration.receipt.indexed
          );
        }
        const history = await createPublicApi(apiOrigin).provenance(
          operation.kathaId,
          { limit: "100" },
          { signal },
        );
        return (
          history.chain.cluster.toLowerCase() === operation.cluster &&
          history.items.some((item) => item.transaction.signature === signature)
        );
      },
    );
    publish({ connection: current.boundary, session: auth, transactions: flow });
    return () => {
      if (runtime.connection === current.boundary) publish(emptyRuntime);
      flow.dispose();
      auth.dispose();
      current.dispose();
    };
  }, [cluster, apiOrigin, appOrigin, rpcUrl]);
  return <>{children}</>;
}
export function useWalletConnection() {
  return useRuntime().connection;
}
export function useWalletSession() {
  return useRuntime().session;
}
export function useTransactionLifecycle() {
  return useRuntime().transactions;
}
