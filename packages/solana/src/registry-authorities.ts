import { fetchEncodedAccount, type EncodedAccount } from "@solana/kit";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { findConfigPda } from "./generated/registry/index.js";
import { nonzeroAddress, readRegistryConfiguration } from "./registration.js";
import { findGovernancePda } from "./generated/registry/index.js";
import { readOperatorAuthorization, type OperatorAuthorization } from "./governance.js";
import { assertKathaRpcCluster } from "./rpc-cluster.js";
import { retryRpcRead } from "./rpc-retry.js";

export type RegistryAuthorityRole =
  "authority" | "registrationAuthority" | "verifierAuthority" | "custodyAuthority";
export type RegistryAuthorities = Readonly<Record<RegistryAuthorityRole, string>> & {
  readonly operatorAuthorization?: OperatorAuthorization | undefined;
};

export async function readRegistryAuthorities(
  account: EncodedAccount,
): Promise<RegistryAuthorities> {
  const { state } = await readRegistryConfiguration(account);
  return Object.freeze({
    authority: nonzeroAddress(state.authority),
    registrationAuthority: nonzeroAddress(state.registrationAuthority),
    verifierAuthority: nonzeroAddress(state.verifierAuthority),
    custodyAuthority: nonzeroAddress(state.custodyAuthority),
  });
}

/** Fresh finalized reads; no authority cache, signer, or transaction submission. */
export function createRegistryAuthorityReader(config: KathaRpcConfig) {
  const client = createKathaRpcClient(config);
  return async (wallet?: string): Promise<RegistryAuthorities> => {
    // Bound permission recovery below the browser request timeout; never reuse a grant.
    const signal = AbortSignal.timeout(8000);
    const [configAddress] = await findConfigPda();
    const account = await retryRpcRead(
      () =>
        fetchEncodedAccount(client.rpc, configAddress, {
          commitment: "finalized",
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        }),
      signal,
    );
    if (!account.exists) throw new TypeError("Registry is not initialized");
    const authorities = await readRegistryAuthorities(account);
    if (authorities.registrationAuthority !== (await findGovernancePda())[0])
      return authorities;
    assertKathaRpcCluster(
      await retryRpcRead(
        () =>
          client.rpc.getGenesisHash().send({
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          }),
        signal,
      ),
      config.cluster,
    );
    if (!wallet)
      throw new TypeError("Operator identity is required after governance activation");
    const { address } = await import("@solana/kit");
    return {
      ...authorities,
      operatorAuthorization: await readOperatorAuthorization(
        client.rpc,
        address(wallet),
        signal,
      ),
    };
  };
}

/** Bind the worker's collection filter to the finalized Registry configuration. */
export function createRegistryCollectionReader(config: KathaRpcConfig) {
  const client = createKathaRpcClient(config);
  return async (): Promise<string> => {
    const [configAddress] = await findConfigPda();
    const account = await fetchEncodedAccount(client.rpc, configAddress, {
      commitment: "finalized",
      abortSignal: AbortSignal.timeout(5000),
    });
    if (!account.exists) throw new TypeError("Registry is not initialized");
    const { state } = await readRegistryConfiguration(account);
    return nonzeroAddress(state.collection);
  };
}
