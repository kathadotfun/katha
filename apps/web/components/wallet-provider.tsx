"use client";

import { createContext, useContext, useEffect, useState } from "react";
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
const TransactionContext = createContext<TransactionLifecycle | null>(null);
const SessionContext = createContext<WalletSessionController | null>(null);
const WalletContext = createContext<WalletConnection | null>(null);
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
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [session, setSession] = useState<WalletSessionController | null>(null);
  const [transactions, setTransactions] = useState<TransactionLifecycle | null>(null);
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
    );
    setTransactions(flow);
    setConnection(current.boundary);
    setSession(auth);
    return () => {
      flow.dispose();
      auth.dispose();
      current.dispose();
    };
  }, [cluster, apiOrigin, appOrigin, rpcUrl]);
  return (
    <WalletContext value={connection}>
      <SessionContext value={session}>
        <TransactionContext value={transactions}>{children}</TransactionContext>
      </SessionContext>
    </WalletContext>
  );
}
export function useWalletConnection() {
  return useContext(WalletContext);
}

export function useWalletSession() {
  return useContext(SessionContext);
}

export function useTransactionLifecycle() {
  return useContext(TransactionContext);
}
