import { fetchEncodedAccount, type EncodedAccount } from "@solana/kit";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { findConfigPda } from "./generated/registry/index.js";
import { nonzeroAddress, readRegistryConfiguration } from "./registration.js";

export type RegistryAuthorityRole =
  "authority" | "registrationAuthority" | "verifierAuthority" | "custodyAuthority";
export type RegistryAuthorities = Readonly<Record<RegistryAuthorityRole, string>>;

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
  return async (): Promise<RegistryAuthorities> => {
    const [configAddress] = await findConfigPda();
    const account = await fetchEncodedAccount(client.rpc, configAddress, {
      commitment: "finalized",
      abortSignal: AbortSignal.timeout(5000),
    });
    if (!account.exists) throw new TypeError("Registry is not initialized");
    return readRegistryAuthorities(account);
  };
}
