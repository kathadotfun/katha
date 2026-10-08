import {
  address,
  createSolanaRpc,
  parseBase64RpcAccount,
  getCompiledTransactionMessageDecoder,
  decompileTransactionMessage,
} from "@solana/kit";
import { readCoreAsset } from "@katha/solana";
import { assertKathaRpcCluster } from "@katha/solana/rpc-cluster";
import {
  artworkProvenanceResponseSchema,
  type ArtworkProvenanceResponse,
} from "@katha/shared";
import type { WalletOperation } from "./wallet-operation.ts";
import { decodeCanonicalTransaction } from "./prepared-transaction.ts";
import { publicTransactionRpcUrl } from "./transaction-rpc.ts";
type Purchase = Extract<WalletOperation, { kind: "PURCHASE_ARTWORK" }>;
export function purchaseCollection(operation: Purchase) {
  const message = decompileTransactionMessage(
    getCompiledTransactionMessageDecoder().decode(
      decodeCanonicalTransaction(operation.transactionBase64).messageBytes,
    ),
  );
  // This wire was validated against the reviewed quote before entering the lifecycle.
  const collection = message.instructions[0]?.accounts?.[12]?.address;
  if (!collection) throw new Error("Missing collection");
  return collection;
}
export function createPurchaseOwnershipRpc(
  cluster: "localnet" | "devnet",
  url: string,
) {
  const rpc = createSolanaRpc(publicTransactionRpcUrl(cluster, url));
  return async (operation: Purchase, finalizedSlot: string, signal: AbortSignal) => {
    if (operation.cluster !== cluster) throw new Error("Wrong purchase cluster");
    assertKathaRpcCluster(
      await rpc.getGenesisHash().send({ abortSignal: signal }),
      cluster,
    );
    const asset = address(operation.quote.asset);
    const response = await rpc
      .getAccountInfo(asset, {
        encoding: "base64",
        commitment: "finalized",
        minContextSlot: BigInt(finalizedSlot),
      })
      .send({ abortSignal: signal });
    if (
      typeof response.context.slot !== "bigint" ||
      response.context.slot < BigInt(finalizedSlot)
    )
      throw new Error("Core observation predates finalized purchase");
    const account = parseBase64RpcAccount(asset, response.value);
    return (
      readCoreAsset(account, asset, purchaseCollection(operation)).owner ===
      operation.feePayer
    );
  };
}
export function purchaseHistoryMatches(
  operation: Purchase,
  signature: string,
  input: ArtworkProvenanceResponse,
) {
  const history = artworkProvenanceResponseSchema.parse(input);
  return (
    history.kathaId === operation.kathaId &&
    history.chain.cluster.toLowerCase() === operation.cluster &&
    history.chain.coreAssetAddress === operation.quote.asset &&
    history.chain.collectionAddress === purchaseCollection(operation) &&
    history.items.some(
      (item) =>
        item.type === "TRANSFER" &&
        item.transaction.signature === signature &&
        item.data.assetAddress === operation.quote.asset &&
        item.data.newOwner === operation.feePayer,
    )
  );
}
