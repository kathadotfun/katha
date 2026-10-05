import {
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import { kathaIdSchema, conditionReportCommitmentSchema } from "@katha/shared";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { readRegistryConfiguration } from "./registration.js";
import { readAuthorizedArtwork, checkAccount } from "./attestation.js";
import { type ArtworkMintAccounts } from "./lifecycle.js";
import {
  findConfigPda,
  findArtworkPda,
  findVerificationPda,
  findInitializeMetadataHeadPda,
  findHeadPda,
  findReportPda,
  findInitializeCustodyHeadPda,
  findAssetPda,
  getMetadataHeadDecoder,
  KathaRegistryAccount,
} from "./generated/registry/index.js";
export function createArtworkMintReaderFromRpc(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
) {
  return async (identity: string, reportId: string): Promise<ArtworkMintAccounts> => {
    const kathaId = kathaIdSchema.parse(identity);
    const id = conditionReportCommitmentSchema.shape.reportId.parse(reportId);
    const [config] = await findConfigPda();
    const [artwork] = await findArtworkPda({ kathaId });
    const [verification] = await findVerificationPda({ artwork });
    const [metadata] = await findInitializeMetadataHeadPda({ artwork });
    const [condition] = await findHeadPda({ artwork });
    const [custody] = await findInitializeCustodyHeadPda({ artwork });
    const [asset] = await findAssetPda({ artwork });
    const [initial] = await findReportPda({
      reportId: Uint8Array.from(Buffer.from(id.replaceAll("-", ""), "hex")),
    });
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
      verificationAccount,
      metadataHeadAccount,
      conditionHeadAccount,
      custodyHeadAccount,
      initialConditionAccount,
      collectionAccount,
      assetAccount,
    ] = await fetchEncodedAccounts(
      rpc,
      [
        config,
        artwork,
        verification,
        metadata,
        condition,
        custody,
        initial,
        state.collection,
        asset,
      ],
      options,
    );
    if (
      !configAccount?.exists ||
      !artworkAccount?.exists ||
      !verificationAccount?.exists ||
      !metadataHeadAccount?.exists ||
      !conditionHeadAccount?.exists ||
      !custodyHeadAccount?.exists ||
      !initialConditionAccount?.exists ||
      !collectionAccount?.exists ||
      !assetAccount
    )
      throw new TypeError("Mint prerequisites unavailable");
    const { state: currentConfig } = await readRegistryConfiguration(configAccount);
    if (currentConfig.collection !== collectionAccount.address)
      throw new TypeError("Collection configuration changed");
    await readAuthorizedArtwork(
      { authorityAddress: currentConfig.registrationAuthority },
      { configAccount, artworkAccount },
      kathaId,
      "registrationAuthority",
    );
    checkAccount(metadataHeadAccount, metadata, KathaRegistryAccount.MetadataHead, 109);
    const head = getMetadataHeadDecoder().decode(metadataHeadAccount.data);
    const currentRevisionAccount = await fetchEncodedAccount(
      rpc,
      head.currentRevision,
      options,
    );
    if (!currentRevisionAccount.exists)
      throw new TypeError("Committed metadata unavailable");
    // Revision and initial report are immutable; the mutable prerequisites share one bank snapshot.
    return {
      configAccount,
      artworkAccount,
      verificationAccount,
      metadataHeadAccount,
      currentRevisionAccount,
      conditionHeadAccount,
      custodyHeadAccount,
      initialConditionAccount,
      collectionAccount,
      assetAccount,
    };
  };
}
export function createArtworkMintReader(config: KathaRpcConfig) {
  return createArtworkMintReaderFromRpc(createKathaRpcClient(config).rpc);
}
export type ArtworkMintReader = ReturnType<typeof createArtworkMintReader>;
