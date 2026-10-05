import {
  address,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type Rpc,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
} from "@solana/kit";
import {
  createKathaRpcClient,
  assertOwnedEncodedAccount,
  type KathaRpcConfig,
} from "./client.js";
import {
  findConfigPda,
  findArtworkPda,
  findVerificationPda,
  findHeadPda,
  findReportPda,
  findInitializeCustodyHeadPda,
  findAssetPda,
  getConditionHeadDecoder,
  KathaRegistryAccount,
} from "./generated/registry/index.js";
import { readRegistryConfiguration } from "./registration.js";
import { readAuthorizedArtwork, checkAccount } from "./attestation.js";
import { kathaIdSchema, conditionReportCommitmentSchema } from "@katha/shared";

export function createConditionAttestationReaderFromRpc(
  rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
) {
  return async (identity: string, reportId: string) => {
    const kathaId = kathaIdSchema.parse(identity);
    const id = conditionReportCommitmentSchema.shape.reportId.parse(reportId);
    const [config] = await findConfigPda();
    const [artwork] = await findArtworkPda({ kathaId });
    const [verification] = await findVerificationPda({ artwork });
    const [head] = await findHeadPda({ artwork });
    const [custody] = await findInitializeCustodyHeadPda({ artwork });
    const [asset] = await findAssetPda({ artwork });
    const [report] = await findReportPda({
      reportId: Uint8Array.from(Buffer.from(id.replaceAll("-", ""), "hex")),
    });
    const clock = address("SysvarC1ock11111111111111111111111111111111");
    const options = {
      commitment: "finalized" as const,
      abortSignal: AbortSignal.timeout(10_000),
    };
    // Ownership, custody and condition head are read in the same RPC bank snapshot.
    const accounts = await fetchEncodedAccounts(
      rpc,
      [config, artwork, verification, head, custody, asset, clock, report],
      options,
    );
    const [
      configAccount,
      artworkAccount,
      verificationAccount,
      conditionHeadAccount,
      custodyHeadAccount,
      assetAccount,
      clockAccount,
      targetReport,
    ] = accounts;
    if (
      !configAccount?.exists ||
      !artworkAccount?.exists ||
      !verificationAccount?.exists ||
      !conditionHeadAccount ||
      !custodyHeadAccount ||
      !assetAccount ||
      !clockAccount?.exists ||
      !targetReport
    )
      throw new TypeError("Condition account snapshots are incomplete");
    const { state } = await readRegistryConfiguration(configAccount);
    await readAuthorizedArtwork(
      { authorityAddress: state.verifierAuthority },
      { configAccount, artworkAccount },
      kathaId,
    );
    assertOwnedEncodedAccount(
      clockAccount,
      clock,
      address("Sysvar1111111111111111111111111111111111111"),
      40,
    );
    if (clockAccount.executable || clockAccount.data.length !== 40)
      throw new TypeError("Invalid chain clock");
    const currentUnixTimestamp = new DataView(
      clockAccount.data.buffer,
      clockAccount.data.byteOffset,
      40,
    ).getBigInt64(32, true);
    if (currentUnixTimestamp <= 0n) throw new TypeError("Invalid chain timestamp");
    let currentReportAccount = null;
    if (conditionHeadAccount.exists) {
      checkAccount(conditionHeadAccount, head, KathaRegistryAccount.ConditionHead, 109);
      const current = getConditionHeadDecoder().decode(conditionHeadAccount.data);
      const reportAccount = await fetchEncodedAccount(
        rpc,
        current.currentReport,
        options,
      );
      if (!reportAccount.exists)
        throw new TypeError("Current condition report is unavailable");
      currentReportAccount = reportAccount;
    }
    return {
      configAccount,
      artworkAccount,
      verificationAccount,
      conditionHeadAccount,
      custodyHeadAccount,
      assetAccount,
      currentReportAccount,
      currentUnixTimestamp,
      targetReportAddress: report,
      targetReportExists: targetReport.exists,
    };
  };
}
export function createConditionAttestationReader(config: KathaRpcConfig) {
  return createConditionAttestationReaderFromRpc(createKathaRpcClient(config).rpc);
}
export type ConditionAttestationReader = ReturnType<
  typeof createConditionAttestationReader
>;
