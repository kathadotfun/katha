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

const SessionContext = createContext<WalletSessionController | null>(null);
const WalletContext = createContext<WalletConnection | null>(null);
export function WalletProvider({
  children,
  cluster,
  apiOrigin,
  appOrigin,
}: {
  children: React.ReactNode;
  cluster: WalletSession["cluster"];
  apiOrigin: string;
  appOrigin: string;
}) {
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [session, setSession] = useState<WalletSessionController | null>(null);
  useEffect(() => {
    const current = createBrowserWalletConnection(cluster);
    const auth = createWalletSession(
      current.boundary,
      createWalletSessionApi(apiOrigin),
      appOrigin,
    );
    setConnection(current.boundary);
    setSession(auth);
    return () => {
      auth.dispose();
      current.dispose();
    };
  }, [cluster, apiOrigin, appOrigin]);
  return (
    <WalletContext value={connection}>
      <SessionContext value={session}>{children}</SessionContext>
    </WalletContext>
  );
}
export function useWalletConnection() {
  return useContext(WalletContext);
}

export function useWalletSession() {
  return useContext(SessionContext);
}
