import {
  address,
  fetchEncodedAccount,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import {
  findArtworkPda,
  findConfigPda,
  findVerificationPda,
} from "./generated/registry/index.js";
import { nonzeroAddress, readRegistryConfiguration } from "./registration.js";
import { readAuthorizedArtwork, type VerifierArtworkAccounts } from "./attestation.js";
import { kathaIdSchema } from "@katha/shared";
import type { OperatorAuthorization } from "./governance.js";

export function createArtworkVerificationReaderFromRpc(rpc: Rpc<GetAccountInfoApi>) {
  return async (identity: string) => {
    const kathaId = kathaIdSchema.parse(identity);
    const [config] = await findConfigPda();
    const [artwork] = await findArtworkPda({ kathaId });
    const [verification] = await findVerificationPda({ artwork });
    const abortSignal = AbortSignal.timeout(10_000);
    const [configAccount, artworkAccount, verificationAccount] = await Promise.all([
      fetchEncodedAccount(rpc, config, { commitment: "finalized", abortSignal }),
      fetchEncodedAccount(rpc, artwork, { commitment: "finalized", abortSignal }),
      fetchEncodedAccount(rpc, verification, { commitment: "finalized", abortSignal }),
    ]);
    if (!configAccount.exists || !artworkAccount.exists)
      throw new TypeError("Registered artwork and configuration are required");
    const { state } = await readRegistryConfiguration(configAccount);
    await readAuthorizedArtwork(
      { authorityAddress: state.verifierAuthority },
      { configAccount, artworkAccount },
      kathaId,
    );
    if (verificationAccount.address !== verification)
      throw new TypeError("Verification account address mismatch");
    return {
      configAccount,
      artworkAccount,
      verificationAddress: verification,
      verificationExists: verificationAccount.exists,
    };
  };
}
export function createArtworkVerificationReader(config: KathaRpcConfig) {
  return createArtworkVerificationReaderFromRpc(createKathaRpcClient(config).rpc);
}
export type ArtworkVerificationReader = ReturnType<
  typeof createArtworkVerificationReader
>;

/** Validates the signer and immutable registered identity through the Kit adapter. */
export async function readArtworkVerificationIdentity(
  accounts: VerifierArtworkAccounts,
  authority: string,
  kathaId: string,
  authorization?: OperatorAuthorization,
) {
  return (
    await readAuthorizedArtwork(
      { authorityAddress: nonzeroAddress(address(authority)), authorization },
      accounts,
      kathaId,
    )
  ).record;
}
