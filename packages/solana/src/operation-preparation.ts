import { sha256Hex } from "@katha/shared";
import {
  assertIsTransactionWithinSizeLimit,
  address,
  blockhash,
  compileTransaction,
  getBase64EncodedWireTransaction,
  type GetLatestBlockhashApi,
  type GetBlockHeightApi,
  type SimulateTransactionApi,
  type Rpc,
} from "@solana/kit";
import {
  createKathaRpcClient,
  selectKathaTransactionVersion,
  type KathaRpcConfig,
  type WalletTransactionVersion,
} from "./client.js";
import type { RegistryTransactionContext, unsignedMessage } from "./registration.js";

export type UnsignedRegistryTransaction = ReturnType<typeof unsignedMessage>;
export class OperationSimulationError extends Error {
  constructor(public readonly code: "REJECTED" | "UNAVAILABLE") {
    super("Operation simulation could not complete");
    this.name = "OperationSimulationError";
  }
}
const u64 = (value: unknown): bigint => {
  if (typeof value !== "bigint" || value < 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new TypeError("Invalid RPC integer");
  return value;
};
export async function encodeUnsignedRegistryTransaction(
  prepared: UnsignedRegistryTransaction,
) {
  const transaction = compileTransaction(prepared.transactionMessage);
  assertIsTransactionWithinSizeLimit(transaction);
  if (Object.values(transaction.signatures).some((signature) => signature !== null))
    throw new TypeError("Preparation must be unsigned");
  const wire = getBase64EncodedWireTransaction(transaction);
  const signerAddresses = Object.keys(transaction.signatures).map((value) =>
    address(value),
  );
  return {
    transactionBase64: wire,
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    requiredSignerAddresses: signerAddresses,
    transactionVersion: prepared.transactionMessage.version,
    feePayer: prepared.transactionMessage.feePayer.address,
    ...prepared.transactionMessage.lifetimeConstraint,
  };
}
export function createOperationChainFromRpc(
  rpc: Rpc<GetLatestBlockhashApi & GetBlockHeightApi & SimulateTransactionApi>,
  cluster: KathaRpcConfig["cluster"],
) {
  return {
    async context(
      wallet: string,
      versions: ReadonlySet<WalletTransactionVersion>,
    ): Promise<RegistryTransactionContext> {
      selectKathaTransactionVersion(cluster, versions);
      const signal = AbortSignal.timeout(10_000);
      const [latest, height] = await Promise.all([
        rpc
          .getLatestBlockhash({ commitment: "confirmed" })
          .send({ abortSignal: signal }),
        rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal: signal }),
      ]);
      const lifetime = {
        blockhash: blockhash(latest.value.blockhash),
        lastValidBlockHeight: u64(latest.value.lastValidBlockHeight),
      };
      if (u64(height) >= lifetime.lastValidBlockHeight)
        throw new TypeError("Expired blockhash");
      return {
        cluster,
        feePayerAddress: address(wallet),
        authorityAddress: address(wallet),
        supportedTransactionVersions: versions,
        lifetime,
        currentBlockHeight: height,
      };
    },
    async simulate(prepared: UnsignedRegistryTransaction) {
      const encoded = await encodeUnsignedRegistryTransaction(prepared);
      if (
        encoded.requiredSignerAddresses.length !== 1 ||
        encoded.requiredSignerAddresses[0] !== encoded.feePayer
      )
        throw new OperationSimulationError("REJECTED");
      let response;
      try {
        response = await rpc
          .simulateTransaction(encoded.transactionBase64, {
            encoding: "base64",
            commitment: "confirmed",
            sigVerify: false,
            replaceRecentBlockhash: false,
          })
          .send({ abortSignal: AbortSignal.timeout(10_000) });
        if (response.value.err === undefined)
          throw new TypeError("Missing simulation result");
        u64(response.context.slot);
        if (response.value.unitsConsumed !== undefined)
          u64(response.value.unitsConsumed);
      } catch {
        throw new OperationSimulationError("UNAVAILABLE");
      }
      if (response.value.err !== null) throw new OperationSimulationError("REJECTED");
      // Recheck expiry after simulation; never substitute different bytes or lifetime.
      try {
        const height = u64(
          await rpc
            .getBlockHeight({ commitment: "confirmed" })
            .send({ abortSignal: AbortSignal.timeout(10_000) }),
        );
        if (height >= encoded.lastValidBlockHeight)
          throw new OperationSimulationError("REJECTED");
      } catch (error) {
        if (error instanceof OperationSimulationError) throw error;
        throw new OperationSimulationError("UNAVAILABLE");
      }
      return {
        ...encoded,
        simulation: {
          slot: response.context.slot.toString(),
          unitsConsumed: response.value.unitsConsumed?.toString() ?? null,
        },
      };
    },
  };
}
export function createOperationChain(config: KathaRpcConfig) {
  return createOperationChainFromRpc(createKathaRpcClient(config).rpc, config.cluster);
}
export type OperationChain = ReturnType<typeof createOperationChain>;
