import { blockhash } from "@solana/kit";
import type { KathaCluster } from "./client.js";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PUBLIC_GENESIS = [
  DEVNET_GENESIS,
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
];
export function assertKathaRpcCluster(genesis: string, cluster: KathaCluster): void {
  if (cluster !== "localnet" && cluster !== "devnet")
    throw new Error("Unsupported RPC cluster");
  blockhash(genesis);
  if (
    cluster === "devnet" ? genesis !== DEVNET_GENESIS : PUBLIC_GENESIS.includes(genesis)
  )
    throw new Error("RPC cluster mismatch");
}
