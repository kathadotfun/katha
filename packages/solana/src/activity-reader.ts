import {
  signature,
  type GetSignaturesForAddressApi,
  type GetTransactionApi,
  type GetGenesisHashApi,
  type GetBlockApi,
  type Rpc,
  type Address,
} from "@solana/kit";
import {
  createKathaRpcClient,
  type KathaRpcConfig,
  type KathaCluster,
} from "./client.js";
import { assertKathaRpcCluster } from "./rpc-cluster.js";
import { CORE_PROGRAM_ADDRESS } from "./core.js";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "./generated/registry/index.js";
import {
  ActivityEvidenceError,
  activityRecord,
  activityArray,
  activitySlot,
  decodeFinalizedActivity,
  type ActivityTransaction,
} from "./chain-activity.js";

export interface ActivityPageRequest {
  programAddress: Address;
  before?: string;
  until?: string;
  limit?: number;
}
export interface ActivityPage {
  cluster: KathaCluster;
  programAddress: Address;
  headSignature: string | null;
  genesisHash?: string;
  nextBefore: string | null;
  transactions: (ActivityTransaction & { transactionIndex: number })[];
}
export function createActivityReaderFromRpc(
  rpc: Rpc<
    GetGenesisHashApi & GetSignaturesForAddressApi & GetTransactionApi & GetBlockApi
  >,
  cluster: KathaCluster,
) {
  return async (
    request: ActivityPageRequest,
    signal?: AbortSignal,
  ): Promise<ActivityPage> => {
    const limit = request.limit ?? 25;
    if (
      (request.programAddress !== KATHA_REGISTRY_PROGRAM_ADDRESS &&
        request.programAddress !== CORE_PROGRAM_ADDRESS) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (request.before !== undefined && request.before === request.until)
    )
      throw new ActivityEvidenceError();
    const before = request.before === undefined ? undefined : signature(request.before);
    const until = request.until === undefined ? undefined : signature(request.until);
    const abortSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000);
    const genesisHash = await rpc.getGenesisHash().send({ abortSignal });
    assertKathaRpcCluster(genesisHash, cluster);
    const rows = activityArray(
      await rpc
        .getSignaturesForAddress(request.programAddress, {
          commitment: "finalized",
          limit,
          ...(before === undefined ? {} : { before }),
          ...(until === undefined ? {} : { until }),
        })
        .send({ abortSignal }),
      limit,
    ).map(activityRecord);
    const seen = new Set<string>();
    let lastSlot: bigint | null = null;
    for (const row of rows) {
      if (
        typeof row.signature !== "string" ||
        row.confirmationStatus !== "finalized" ||
        row.err === undefined
      )
        throw new ActivityEvidenceError();
      signature(row.signature);
      const slot = activitySlot(row.slot);
      if (
        seen.has(row.signature) ||
        row.signature === before ||
        row.signature === until ||
        (lastSlot !== null && slot > lastSlot)
      )
        throw new ActivityEvidenceError();
      seen.add(row.signature);
      lastSlot = slot;
    }
    const blocks = new Map<bigint, string[]>();
    const transactions: ActivityPage["transactions"] = [];
    for (const row of rows) {
      const transactionSignature = row.signature as string,
        slot = activitySlot(row.slot);
      const response = await rpc
        .getTransaction(signature(transactionSignature), {
          commitment: "finalized",
          encoding: "json",
          maxSupportedTransactionVersion: 1,
        })
        .send({ abortSignal });
      if (response === null) throw new ActivityEvidenceError();
      const transaction = decodeFinalizedActivity(response, transactionSignature, slot);
      if ((row.err === null) !== (transaction.outcome === "SUCCESS"))
        throw new ActivityEvidenceError();
      // A program-address signature listing is only discovery, not successful instruction proof.
      const message = activityRecord(
        activityRecord(activityRecord(response).transaction).message,
      );
      const loaded = activityRecord(
        response.meta?.loadedAddresses ?? { writable: [], readonly: [] },
      );
      const keys = [
        ...activityArray(message.accountKeys),
        ...activityArray(loaded.writable),
        ...activityArray(loaded.readonly),
      ];
      if (!keys.includes(request.programAddress)) throw new ActivityEvidenceError();
      let signatures = blocks.get(slot);
      if (!signatures) {
        const block = await rpc
          .getBlock(slot, {
            commitment: "finalized",
            transactionDetails: "signatures",
            maxSupportedTransactionVersion: 1,
            rewards: false,
          })
          .send({ abortSignal });
        const values = activityArray(activityRecord(block).signatures, 65536);
        signatures = values.map((value) =>
          typeof value === "string"
            ? signature(value)
            : (() => {
                throw new ActivityEvidenceError();
              })(),
        );
        if (new Set(signatures).size !== signatures.length)
          throw new ActivityEvidenceError();
        blocks.set(slot, signatures);
      }
      const transactionIndex = signatures.indexOf(transactionSignature);
      if (transactionIndex < 0) throw new ActivityEvidenceError();
      transactions.push({ ...transaction, transactionIndex });
    }
    transactions.sort((a, b) =>
      a.slot < b.slot
        ? -1
        : a.slot > b.slot
          ? 1
          : a.transactionIndex - b.transactionIndex,
    );
    return {
      cluster,
      genesisHash,
      programAddress: request.programAddress,
      headSignature: rows.length ? (rows[0]!.signature as string) : null,
      nextBefore: rows.length === limit ? (rows.at(-1)!.signature as string) : null,
      transactions,
    };
  };
}
export function createActivityReader(config: KathaRpcConfig) {
  return createActivityReaderFromRpc(createKathaRpcClient(config).rpc, config.cluster);
}
export type ActivityReader = ReturnType<typeof createActivityReader>;
