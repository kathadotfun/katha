import {
  address,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type GetMultipleAccountsApi,
  lamports,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import { expect, it, vi } from "vitest";
import { createConditionAttestationReaderFromRpc } from "../src/condition-attestation-reader.js";
import {
  findConfigPda,
  findArtworkPda,
  findCollectionAuthorityPda,
  getKathaConfigEncoder,
  getArtworkRecordEncoder,
  findVerificationPda,
  findHeadPda,
  findInitializeCustodyHeadPda,
  findAssetPda,
  findReportPda,
  ArtworkCategory,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
} from "../src/generated/registry/index.js";
vi.mock("@solana/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@solana/kit")>()),
  fetchEncodedAccount: vi.fn(),
  fetchEncodedAccounts: vi.fn(),
}));
async function fixture() {
  const [config, bump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const wallet = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const data = Uint8Array.from(
    getKathaConfigEncoder().encode({
      authority: wallet,
      registrationAuthority: wallet,
      verifierAuthority: wallet,
      custodyAuthority: wallet,
      treasury: wallet,
      collection: wallet,
      collectionAuthority,
      bump,
      collectionAuthorityBump,
    }),
  );
  const configAccount = {
    exists: true as const,
    address: config,
    programAddress: REGISTRY as Address,
    data,
    space: BigInt(data.length),
    lamports: lamports(1n),
    executable: false,
  };
  const kathaId = "KATHA-PAUBHA-000001";
  const [artwork, artworkBump] = await findArtworkPda({ kathaId });
  const [verification] = await findVerificationPda({ artwork });
  const artworkData = new Uint8Array(246);
  artworkData.set(
    getArtworkRecordEncoder().encode({
      kathaId,
      artistId: "11111111-1111-4111-8111-111111111111",
      creatorWallet: null,
      category: ArtworkCategory.Paubha,
      creationYear: 2026,
      authorshipEvidenceHash: new Uint8Array(32).fill(1),
      collection: wallet,
      coreAsset: null,
      registeredBy: wallet,
      registeredAt: 1n,
      bump: artworkBump,
    }),
  );
  const artworkAccount = {
    ...configAccount,
    address: artwork,
    data: artworkData,
    space: 246n,
  };
  vi.mocked(fetchEncodedAccount).mockReset();
  const mock = vi
    .mocked(fetchEncodedAccount)
    .mockResolvedValueOnce(configAccount)
    .mockResolvedValueOnce(artworkAccount)
    .mockResolvedValueOnce({ exists: false, address: verification });
  const reportId = "11111111-1111-4111-8111-111111111111";
  const [target] = await findReportPda({ reportId: new Uint8Array(16).fill(0x11) });
  const [head] = await findHeadPda({ artwork });
  const [custody] = await findInitializeCustodyHeadPda({ artwork });
  const [asset] = await findAssetPda({ artwork });
  const clockAddress = address("SysvarC1ock11111111111111111111111111111111");
  const clockData = new Uint8Array(40);
  new DataView(clockData.buffer).setBigInt64(32, 2_000_000_000n, true);
  const clock = {
    ...configAccount,
    address: clockAddress,
    data: clockData,
    space: 40n,
    programAddress: address("Sysvar1111111111111111111111111111111111111"),
  };
  const rows = [
    configAccount,
    artworkAccount,
    { ...configAccount, address: verification },
    { exists: false as const, address: head },
    { exists: false as const, address: custody },
    { exists: false as const, address: asset },
    clock,
    { exists: false as const, address: target },
  ];
  vi.mocked(fetchEncodedAccounts).mockReset().mockResolvedValue(rows);
  const rpc = {} as Rpc<GetAccountInfoApi & GetMultipleAccountsApi>;
  return {
    configAccount,
    rows,
    clock,
    reportId,
    target,
    artwork,
    artworkAccount,
    verification,
    kathaId,
    mock,
    read: createConditionAttestationReaderFromRpc(rpc),
    wallet,
  };
}
it("reads ownership/custody/condition/clock in one finalized RPC snapshot with a deadline", async () => {
  const f = await fixture();
  const result = await f.read(f.kathaId, f.reportId);
  expect(result.currentUnixTimestamp).toBe(2_000_000_000n);
  expect(result.targetReportExists).toBe(false);
  expect(vi.mocked(fetchEncodedAccounts).mock.calls[0]![2]).toMatchObject({
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
  expect(result.currentReportAccount).toBeNull();
});
it.each([
  "missing-clock",
  "clock-owner",
  "clock-size",
  "negative-clock",
  "missing-artwork",
  "wrong-artwork-owner",
])("rejects %s", async (reason) => {
  const f = await fixture();
  const rows = [...f.rows];
  if (reason === "missing-clock") rows[6] = { exists: false, address: f.clock.address };
  if (reason === "clock-owner") rows[6] = { ...f.clock, programAddress: f.wallet };
  if (reason === "clock-size") rows[6] = { ...f.clock, data: new Uint8Array(39) };
  if (reason === "negative-clock") {
    const data = new Uint8Array(40);
    new DataView(data.buffer).setBigInt64(32, -1n, true);
    rows[6] = { ...f.clock, data };
  }
  if (reason === "missing-artwork") rows[1] = { exists: false, address: f.artwork };
  if (reason === "wrong-artwork-owner")
    rows[1] = { ...f.artworkAccount, programAddress: f.wallet };
  vi.mocked(fetchEncodedAccounts).mockResolvedValueOnce(rows);
  await expect(f.read(f.kathaId, f.reportId)).rejects.toThrow();
});
it("propagates RPC unavailability without treating the head as absent", async () => {
  const f = await fixture();
  vi.mocked(fetchEncodedAccounts).mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(f.read(f.kathaId, f.reportId)).rejects.toThrow("RPC unavailable");
});
