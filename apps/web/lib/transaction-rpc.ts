import type { WalletOperation } from "./wallet-operation.ts";
import {
  type TransactionMessageBytesBase64,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getBase64Decoder,
  getSignatureFromTransaction,
} from "@solana/kit";
import { assertKathaRpcCluster } from "@katha/solana/rpc-cluster";
import { retryRpcRead } from "@katha/solana";

import { decodeCanonicalTransaction } from "./prepared-transaction.ts";
export function publicTransactionRpcUrl(
  cluster: "localnet" | "devnet",
  value?: string,
) {
  const url = new URL(
    value ??
      (cluster === "devnet"
        ? "https://api.devnet.solana.com"
        : "http://127.0.0.1:8899"),
  );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol) ||
    (cluster === "devnet" && url.protocol !== "https:") ||
    ["api.mainnet-beta.solana.com", "api.testnet.solana.com"].includes(url.hostname)
  )
    throw new Error("Invalid public transaction RPC URL.");
  return url.href;
}
export function createTransactionRpc(cluster: "localnet" | "devnet", url?: string) {
  const rpc = createSolanaRpc(publicTransactionRpcUrl(cluster, url));
  async function check(signal: AbortSignal) {
    assertKathaRpcCluster(
      await retryRpcRead(
        () => rpc.getGenesisHash().send({ abortSignal: signal }),
        signal,
      ),
      cluster,
    );
  }
  return {
    async height(signal: AbortSignal) {
      await check(signal);
      return retryRpcRead(
        () =>
          rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal: signal }),
        signal,
      );
    },
    async simulate(operation: WalletOperation, signal: AbortSignal) {
      await check(signal);
      const response = await retryRpcRead(
        () =>
          rpc
            .simulateTransaction(
              getBase64EncodedWireTransaction(
                decodeCanonicalTransaction(operation.transactionBase64),
              ),
              {
                encoding: "base64",
                commitment: "confirmed",
                sigVerify: false,
                replaceRecentBlockhash: false,
                minContextSlot: BigInt(operation.simulation.slot),
              },
            )
            .send({ abortSignal: signal }),
        signal,
      );
      if (
        response.value.err !== null ||
        typeof response.context.slot !== "bigint" ||
        response.context.slot < BigInt(operation.simulation.slot)
      )
        throw new Error("Simulation rejected.");
      const fee = await retryRpcRead(
        () =>
          rpc
            .getFeeForMessage(
              getBase64Decoder().decode(
                decodeCanonicalTransaction(operation.transactionBase64).messageBytes,
              ) as TransactionMessageBytesBase64,
              { commitment: "confirmed" },
            )
            .send({ abortSignal: signal }),
        signal,
      );
      if (typeof fee.value !== "bigint" || fee.value < 0n)
        throw new Error("Fee unavailable.");
      return {
        slot: response.context.slot.toString(),
        unitsConsumed: response.value.unitsConsumed?.toString() ?? null,
        feeLamports: fee.value.toString(),
      };
    },
    async submit(wire: string, signal: AbortSignal) {
      await check(signal);
      const tx = decodeCanonicalTransaction(wire);
      // One client submission. maxRetries is left to the node, which rebroadcasts these
      // identical signed bytes until the blockhash expires; one signature executes at most once.
      const result = await rpc
        .sendTransaction(getBase64EncodedWireTransaction(tx), {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
        })
        .send({ abortSignal: signal });
      if (result !== getSignatureFromTransaction(tx))
        throw new Error("Unexpected submission signature.");
    },
  };
}
export type TransactionRpc = ReturnType<typeof createTransactionRpc>;
