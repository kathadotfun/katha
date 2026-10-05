import {
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { kathaIdSchema } from "@katha/shared";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { readRegistryConfiguration } from "./registration.js";
import { readAuthorizedArtwork, checkAccount } from "./attestation.js";
import type {
  ArtworkLifecycleAccounts,
  MetadataRevisionAccounts,
  MintedMetadataAccounts,
} from "./lifecycle.js";
import {
  findConfigPda,
  findArtworkPda,
  findInitializeMetadataHeadPda,
  findAssetPda,
  getMetadataHeadDecoder,
  KathaRegistryAccount,
} from "./generated/registry/index.js";

export type MetadataRevisionSnapshot =
  | ({ mode: "INITIALIZE" } & ArtworkLifecycleAccounts)
  | ({ mode: "UNMINTED" } & MetadataRevisionAccounts)
  | ({ mode: "MINTED" } & MintedMetadataAccounts);
export function createMetadataRevisionReaderFromRpc(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
) {
  return async (identity: string): Promise<MetadataRevisionSnapshot> => {
    const kathaId = kathaIdSchema.parse(identity);
    const [config] = await findConfigPda();
    const [artwork] = await findArtworkPda({ kathaId });
    const [head] = await findInitializeMetadataHeadPda({ artwork });
    const [asset] = await findAssetPda({ artwork });
    const options = {
      commitment: "finalized" as const,
      abortSignal: AbortSignal.timeout(10000),
    };
    const bootstrap = await fetchEncodedAccount(rpc, config, options);
    if (!bootstrap.exists) throw new TypeError("Configuration unavailable");
    const { state } = await readRegistryConfiguration(bootstrap);
    const [
      configAccount,
      artworkAccount,
      metadataHeadAccount,
      collectionAccount,
      assetAccount,
    ] = await fetchEncodedAccounts(
      rpc,
      [config, artwork, head, state.collection, asset],
      options,
    );
    if (
      !configAccount?.exists ||
      !artworkAccount?.exists ||
      !metadataHeadAccount ||
      !collectionAccount ||
      !assetAccount
    )
      throw new TypeError("Metadata prerequisites unavailable");
    const { state: currentConfig } = await readRegistryConfiguration(configAccount);
    if (currentConfig.collection !== collectionAccount.address)
      throw new TypeError("Collection configuration changed");
    const base = { configAccount, artworkAccount };
    const { record } = await readAuthorizedArtwork(
      { authorityAddress: currentConfig.registrationAuthority },
      base,
      kathaId,
      "registrationAuthority",
    );
    const binding = record.coreAsset;
    const minted = binding.__option === "Some";
    if (minted ? binding.value !== asset || !assetAccount.exists : assetAccount.exists)
      throw new TypeError("Invalid Core asset binding");
    if (!metadataHeadAccount.exists) {
      if (minted) throw new TypeError("Minted artwork has no metadata head");
      return { ...base, mode: "INITIALIZE" };
    }
    checkAccount(metadataHeadAccount, head, KathaRegistryAccount.MetadataHead, 109);
    const metadata = getMetadataHeadDecoder().decode(metadataHeadAccount.data);
    const currentRevisionAccount = await fetchEncodedAccount(
      rpc,
      metadata.currentRevision,
      options,
    );
    if (!currentRevisionAccount.exists)
      throw new TypeError("Committed metadata unavailable");
    // Immutable revision may be fetched separately; mutable Registry/Core accounts share a snapshot.
    const revision = { ...base, metadataHeadAccount, currentRevisionAccount };
    if (!minted) return { ...revision, mode: "UNMINTED" };
    if (!collectionAccount.exists || !assetAccount.exists)
      throw new TypeError("Core prerequisites unavailable");
    return { ...revision, mode: "MINTED", collectionAccount, assetAccount };
  };
}
export function createMetadataRevisionReader(config: KathaRpcConfig) {
  return createMetadataRevisionReaderFromRpc(createKathaRpcClient(config).rpc);
}
export type MetadataRevisionReader = ReturnType<typeof createMetadataRevisionReader>;
