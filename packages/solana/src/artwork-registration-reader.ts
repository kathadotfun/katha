import { fetchEncodedAccount, type GetAccountInfoApi, type Rpc } from "@solana/kit";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { findArtworkPda, findConfigPda } from "./generated/registry/index.js";
import { readRegistryConfiguration } from "./registration.js";
import { kathaIdSchema } from "@katha/shared";

export function createArtworkRegistrationReaderFromRpc(rpc: Rpc<GetAccountInfoApi>) {
  return async (kathaId: string) => {
    kathaIdSchema.parse(kathaId);
    const [config] = await findConfigPda();
    const [artwork] = await findArtworkPda({ kathaId });
    const abortSignal = AbortSignal.timeout(10_000);
    const [configAccount, artworkAccount] = await Promise.all([
      fetchEncodedAccount(rpc, config, { commitment: "finalized", abortSignal }),
      fetchEncodedAccount(rpc, artwork, { commitment: "finalized", abortSignal }),
    ]);
    // Configuration owner, size, discriminator and PDA relationships must be valid.
    if (!configAccount.exists)
      throw new TypeError("Registry configuration is unavailable");
    await readRegistryConfiguration(configAccount);
    if (artworkAccount.address !== artwork)
      throw new TypeError("Artwork account address mismatch");
    return {
      configAccount,
      artworkAddress: artwork,
      artworkExists: artworkAccount.exists,
    };
  };
}
export function createArtworkRegistrationReader(config: KathaRpcConfig) {
  return createArtworkRegistrationReaderFromRpc(createKathaRpcClient(config).rpc);
}
export type ArtworkRegistrationReader = ReturnType<
  typeof createArtworkRegistrationReader
>;
