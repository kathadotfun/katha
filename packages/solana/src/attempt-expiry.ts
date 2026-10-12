import {
  signature,
  type GetBlockHeightApi,
  type GetGenesisHashApi,
  type GetSignatureStatusesApi,
  type GetSlotApi,
  type Rpc,
} from "@solana/kit";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { assertKathaRpcCluster } from "./rpc-cluster.js";

// Extra finalized blocks beyond the blockhash lifetime absorb load-balanced RPC lag.
export const ATTEMPT_EXPIRY_MARGIN_BLOCKS = 32n;

/**
 * Resolves true only when a signed attempt can provably never execute: the finalized
 * chain is past its blockhash lifetime, and a history search from at least that
 * finalized slot has no record of the signature. Height is read before status, so a
 * transaction that landed in time is necessarily visible to the later status query.
 * Any doubt (RPC failure, lagging context, a present status) resolves false.
 */
export function createAttemptExpiryReaderFromRpc(
  rpc: Rpc<
    GetGenesisHashApi & GetSlotApi & GetBlockHeightApi & GetSignatureStatusesApi
  >,
  cluster: KathaRpcConfig["cluster"],
) {
  return async (transactionSignature: string, lastValidBlockHeight: bigint) => {
    const abortSignal = AbortSignal.timeout(10_000);
    assertKathaRpcCluster(await rpc.getGenesisHash().send({ abortSignal }), cluster);
    const finalizedSlot = await rpc
      .getSlot({ commitment: "finalized" })
      .send({ abortSignal });
    const finalizedHeight = await rpc
      .getBlockHeight({ commitment: "finalized", minContextSlot: finalizedSlot })
      .send({ abortSignal });
    if (finalizedHeight <= lastValidBlockHeight + ATTEMPT_EXPIRY_MARGIN_BLOCKS)
      return false;
    const statuses = await rpc
      .getSignatureStatuses([signature(transactionSignature)], {
        searchTransactionHistory: true,
      })
      .send({ abortSignal });
    return (
      statuses.context.slot >= finalizedSlot &&
      statuses.value.length === 1 &&
      statuses.value[0] === null
    );
  };
}
export function createAttemptExpiryReader(config: KathaRpcConfig) {
  return createAttemptExpiryReaderFromRpc(
    createKathaRpcClient(config).rpc,
    config.cluster,
  );
}
export type AttemptExpiryReader = ReturnType<typeof createAttemptExpiryReader>;
