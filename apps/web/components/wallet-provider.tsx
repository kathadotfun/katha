"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { WalletSession } from "@katha/shared";
import {
  createBrowserWalletConnection,
  type WalletConnection,
} from "../lib/wallet-connection";

const WalletContext = createContext<WalletConnection | null>(null);
export function WalletProvider({
  children,
  cluster,
}: {
  children: React.ReactNode;
  cluster: WalletSession["cluster"];
}) {
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  useEffect(() => {
    const current = createBrowserWalletConnection(cluster);
    setConnection(current.boundary);
    return () => current.dispose();
  }, [cluster]);
  return <WalletContext value={connection}>{children}</WalletContext>;
}
export function useWalletConnection() {
  return useContext(WalletContext);
}
