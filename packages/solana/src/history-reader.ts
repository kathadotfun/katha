import {
  address,
  getBase64Encoder,
  type GetGenesisHashApi,
  type GetFirstAvailableBlockApi,
  type GetSlotApi,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import {
  createKathaRpcClient,
  type KathaRpcConfig,
  type KathaCluster,
} from "./client.js";
import { assertKathaRpcCluster } from "./rpc-cluster.js";
import { activitySlot, ActivityEvidenceError } from "./chain-activity.js";
import { readCoreAsset } from "./core.js";
export type HistorySnapshot = {
  genesisHash: string;
  firstAvailableBlock: bigint;
  finalizedSlot: bigint;
};
export type CoreOwnerObservation = {
  slot: bigint;
  owner: string | null;
  status: "PRESENT" | "MISSING" | "INVALID";
};
export function createHistoryReaderFromRpc(
  rpc: Rpc<
    GetGenesisHashApi & GetFirstAvailableBlockApi & GetSlotApi & GetAccountInfoApi
  >,
  cluster: KathaCluster,
) {
  const signal = (abort?: AbortSignal) =>
    abort
      ? AbortSignal.any([abort, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000);
  return {
    async snapshot(abort?: AbortSignal): Promise<HistorySnapshot> {
      const abortSignal = signal(abort);
      const genesisHash = await rpc.getGenesisHash().send({ abortSignal });
      assertKathaRpcCluster(genesisHash, cluster);
      const firstAvailableBlock = activitySlot(
        await rpc.getFirstAvailableBlock().send({ abortSignal }),
      );
      const finalizedSlot = activitySlot(
        await rpc.getSlot({ commitment: "finalized" }).send({ abortSignal }),
      );
      if (firstAvailableBlock > finalizedSlot) throw new ActivityEvidenceError();
      return { genesisHash, firstAvailableBlock, finalizedSlot };
    },
    async owner(
      asset: string,
      collection: string,
      minimumSlot: bigint,
      abort?: AbortSignal,
    ): Promise<CoreOwnerObservation> {
      const abortSignal = signal(abort);
      assertKathaRpcCluster(await rpc.getGenesisHash().send({ abortSignal }), cluster);
      const response = await rpc
        .getAccountInfo(address(asset), {
          commitment: "finalized",
          encoding: "base64",
          minContextSlot: minimumSlot,
        })
        .send({ abortSignal });
      const slot = activitySlot(response.context.slot);
      if (slot < minimumSlot) throw new ActivityEvidenceError();
      if (response.value === null) return { slot, owner: null, status: "MISSING" };
      const value = response.value;
      try {
        if (value.data[1] !== "base64") throw new ActivityEvidenceError();
        const view = readCoreAsset(
          {
            exists: true,
            address: address(asset),
            programAddress: value.owner,
            executable: value.executable,
            lamports: value.lamports,
            data: getBase64Encoder().encode(value.data[0]),
            space: value.space,
          },
          address(asset),
          address(collection),
        );
        return { slot, owner: view.owner, status: "PRESENT" };
      } catch {
        return { slot, owner: null, status: "INVALID" };
      }
    },
  };
}
export function createHistoryReader(config: KathaRpcConfig) {
  return createHistoryReaderFromRpc(createKathaRpcClient(config).rpc, config.cluster);
}
export type HistoryReader = ReturnType<typeof createHistoryReader>;
