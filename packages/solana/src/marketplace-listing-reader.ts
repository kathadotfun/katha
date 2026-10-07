import {
  address,
  fetchEncodedAccount,
  parseBase64RpcAccount,
  type Rpc,
  type GetMultipleAccountsApi,
  type GetAccountInfoApi,
  type GetGenesisHashApi,
} from "@solana/kit";
import { kathaIdSchema } from "@katha/shared";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { assertKathaRpcCluster } from "./rpc-cluster.js";
import { readRegistryConfiguration } from "./registration.js";
import { readMarketplaceListingState } from "./marketplace.js";
import * as registry from "./generated/registry/index.js";
import * as market from "./generated/marketplace/index.js";
const CLOCK = address("SysvarC1ock11111111111111111111111111111111");
const SYSVAR = address("Sysvar1111111111111111111111111111111111111");
export function createMarketplaceListingReaderFromRpc(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetGenesisHashApi>,
  cluster: KathaRpcConfig["cluster"],
  includeSaleTerms = false,
) {
  return async (identity: string) => {
    const kathaId = kathaIdSchema.parse(identity),
      signal = AbortSignal.timeout(10000);
    assertKathaRpcCluster(
      await rpc.getGenesisHash().send({ abortSignal: signal }),
      cluster,
    );
    const [registryConfig] = await registry.findConfigPda();
    const bootstrap = await fetchEncodedAccount(rpc, registryConfig, {
      commitment: "finalized",
      abortSignal: signal,
    });
    if (!bootstrap.exists) throw new TypeError("Marketplace snapshot unavailable");
    const { state: platform } = await readRegistryConfiguration(bootstrap);
    const [config] = await market.findConfigPda(),
      [artwork] = await registry.findArtworkPda({ kathaId });
    const [asset] = await registry.findAssetPda({ artwork }),
      [listing] = await market.findListingPda({ asset });
    const [condition] = await registry.findHeadPda({ artwork });
    const [saleTerms] = await market.findSaleTermsPda({ artwork });
    const keys = [
      config,
      registryConfig,
      artwork,
      asset,
      platform.collection,
      listing,
      condition,
      CLOCK,
      ...(includeSaleTerms ? [saleTerms] : []),
    ];
    const response = await rpc
      .getMultipleAccounts(keys, { commitment: "finalized", encoding: "base64" })
      .send({ abortSignal: signal });
    if (
      response.value.length !== keys.length ||
      response.context.slot < 0n ||
      response.context.slot > 18446744073709551615n
    )
      throw new TypeError("Marketplace snapshot unavailable");
    const accounts = keys.map((key, i) => {
      const parsed = parseBase64RpcAccount(key, response.value[i] ?? null);
      return parsed.exists ? { ...parsed, data: Uint8Array.from(parsed.data) } : parsed;
    });
    const [
      marketplaceConfigAccount,
      registryConfigAccount,
      artworkAccount,
      assetAccount,
      collectionAccount,
      listingAccount,
      conditionHeadAccount,
      clock,
    ] = accounts;
    if (
      !marketplaceConfigAccount?.exists ||
      !registryConfigAccount?.exists ||
      !artworkAccount?.exists ||
      !assetAccount?.exists ||
      !collectionAccount?.exists ||
      !listingAccount ||
      !conditionHeadAccount?.exists ||
      !clock?.exists ||
      clock.programAddress !== SYSVAR ||
      clock.executable ||
      clock.data.length !== 40
    )
      throw new TypeError("Marketplace snapshot unavailable");
    const chainTime = new DataView(Uint8Array.from(clock.data).buffer).getBigInt64(
      32,
      true,
    );
    const snapshot = {
      marketplaceConfigAccount,
      registryConfigAccount,
      artworkAccount,
      assetAccount,
      collectionAccount,
      listingAccount,
      conditionHeadAccount,
    };
    const state = await readMarketplaceListingState(snapshot, kathaId, chainTime);
    return {
      accounts: snapshot,
      chainTime,
      observedSlot: response.context.slot,
      state,
      saleTermsAccount: accounts[8],
    };
  };
}
export function createMarketplaceListingReader(config: KathaRpcConfig) {
  return createMarketplaceListingReaderFromRpc(
    createKathaRpcClient(config).rpc,
    config.cluster,
  );
}
export type MarketplaceListingReader = ReturnType<
  typeof createMarketplaceListingReader
>;

export function createMarketplacePurchaseReaderFromRpc(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetGenesisHashApi>,
  cluster: KathaRpcConfig["cluster"],
) {
  const read = createMarketplaceListingReaderFromRpc(rpc, cluster, true);
  return async (identity: string) => {
    const snapshot = await read(identity);
    if (!snapshot.saleTermsAccount?.exists)
      throw new TypeError("Sale terms unavailable");
    return {
      ...snapshot,
      accounts: { ...snapshot.accounts, saleTermsAccount: snapshot.saleTermsAccount },
    };
  };
}
export function createMarketplacePurchaseReader(config: KathaRpcConfig) {
  return createMarketplacePurchaseReaderFromRpc(
    createKathaRpcClient(config).rpc,
    config.cluster,
  );
}
export type MarketplacePurchaseReader = ReturnType<
  typeof createMarketplacePurchaseReader
>;
