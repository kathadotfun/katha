import {
  fetchEncodedAccounts,
  type Rpc,
  type GetMultipleAccountsApi,
} from "@solana/kit";
import { kathaIdSchema } from "@katha/shared";
import { createKathaRpcClient, type KathaRpcConfig } from "./client.js";
import { readAuthorizedArtwork, checkAccount } from "./attestation.js";
import { readRegistryConfiguration } from "./registration.js";
import { nonzeroAddress } from "./registration.js";
import { readCoreAsset } from "./core.js";
import {
  findConfigPda,
  findArtworkPda,
  findInitializeCustodyHeadPda,
  findAssetPda,
  findTransitionCustodyTransitionPda,
  getCustodyHeadDecoder,
  KathaRegistryAccount,
  CustodyState,
} from "./generated/registry/index.js";
export function createCustodyReaderFromRpc(rpc: Rpc<GetMultipleAccountsApi>) {
  return async (identity: string, nextRevision: bigint = 1n) => {
    const kathaId = kathaIdSchema.parse(identity);
    if (nextRevision < 1n || nextRevision > 18446744073709551615n)
      throw new TypeError("Invalid custody revision");
    const [config] = await findConfigPda();
    const [artwork] = await findArtworkPda({ kathaId });
    const [head] = await findInitializeCustodyHeadPda({ artwork });
    const [asset] = await findAssetPda({ artwork });
    const [transition] = await findTransitionCustodyTransitionPda({
      artwork,
      nextRevision,
    });
    const [configAccount, artworkAccount, custodyHeadAccount, assetAccount, target] =
      await fetchEncodedAccounts(rpc, [config, artwork, head, asset, transition], {
        commitment: "finalized",
        abortSignal: AbortSignal.timeout(10000),
      });
    if (
      !configAccount?.exists ||
      !artworkAccount?.exists ||
      !custodyHeadAccount ||
      !assetAccount ||
      !target
    )
      throw new TypeError("Custody snapshot unavailable");
    const { state: configuration } = await readRegistryConfiguration(configAccount);
    const { record } = await readAuthorizedArtwork(
      { authorityAddress: configuration.custodyAuthority },
      { configAccount, artworkAccount },
      kathaId,
      "custodyAuthority",
    );
    let ownerWallet: string | null = null;
    if (record.coreAsset.__option === "Some") {
      if (record.coreAsset.value !== asset || !assetAccount.exists)
        throw new TypeError("Bound Core asset unavailable");
      const core = readCoreAsset(assetAccount, asset, configuration.collection);
      if (core.name !== kathaId) throw new TypeError("Core artwork identity mismatch");
      ownerWallet = nonzeroAddress(core.owner);
    }
    let custodyRevision = 0n;
    let custodyState: "UNKNOWN" | "KATHA_HELD" | "COLLECTOR_HELD" | "IN_TRANSIT" =
      "UNKNOWN";
    let custodySubject: string | null = null;
    if (custodyHeadAccount.exists) {
      checkAccount(custodyHeadAccount, head, KathaRegistryAccount.CustodyHead, 115);
      const current = getCustodyHeadDecoder().decode(custodyHeadAccount.data);
      const [latest] = await findTransitionCustodyTransitionPda({
        artwork,
        nextRevision: current.revision,
      });
      const [, bump] = await findInitializeCustodyHeadPda({ artwork });
      if (
        current.artwork !== artwork ||
        current.bump !== bump ||
        current.revision < 1n ||
        current.latestTransition !== latest ||
        current.state < 1 ||
        current.state > 3
      )
        throw new TypeError("Invalid custody head");
      custodyRevision = current.revision;
      custodyState = (
        ["UNKNOWN", "KATHA_HELD", "COLLECTOR_HELD", "IN_TRANSIT"] as const
      )[current.state]!;
      custodySubject =
        current.subject.__option === "Some" ? current.subject.value : null;
      if (
        (current.state === CustodyState.InTransit && custodySubject !== null) ||
        (current.state !== CustodyState.InTransit &&
          (!custodySubject || /^1{32}$/.test(custodySubject))) ||
        (current.state === CustodyState.KathaHeld &&
          custodySubject !== configuration.custodyAuthority) ||
        (current.state === CustodyState.CollectorHeld &&
          custodySubject === configuration.custodyAuthority)
      )
        throw new TypeError("Invalid custody subject");
    }
    return {
      configAccount,
      artworkAccount,
      custodyHeadAccount,
      assetAccount,
      record,
      configuration,
      ownerWallet,
      custodyRevision,
      custodyState,
      custodySubject,
      targetTransition: transition,
      targetExists: target.exists,
    };
  };
}
export function createCustodyReader(config: KathaRpcConfig) {
  return createCustodyReaderFromRpc(createKathaRpcClient(config).rpc);
}
export type CustodyReader = ReturnType<typeof createCustodyReader>;
