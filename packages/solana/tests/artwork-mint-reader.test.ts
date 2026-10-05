import {
  address,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  lamports,
  type Address,
  type Rpc,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
} from "@solana/kit";
import { expect, it, vi } from "vitest";
import { createArtworkMintReaderFromRpc } from "../src/artwork-mint-reader.js";
import {
  findConfigPda,
  findArtworkPda,
  findCollectionAuthorityPda,
  findVerificationPda,
  findInitializeMetadataHeadPda,
  findHeadPda,
  findInitializeCustodyHeadPda,
  findAssetPda,
  findReportPda,
  getKathaConfigEncoder,
  getArtworkRecordEncoder,
  getMetadataHeadEncoder,
  ArtworkCategory,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
} from "../src/generated/registry/index.js";
vi.mock("@solana/kit", async (original) => ({
  ...(await original<typeof import("@solana/kit")>()),
  fetchEncodedAccount: vi.fn(),
  fetchEncodedAccounts: vi.fn(),
}));
async function fixture() {
  const wallet = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const [config, bump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const cfg = {
    authority: wallet,
    registrationAuthority: wallet,
    verifierAuthority: wallet,
    custodyAuthority: wallet,
    treasury: wallet,
    collection: wallet,
    collectionAuthority,
    bump,
    collectionAuthorityBump,
  };
  const account = (
    address: Address,
    bytes: Uint8Array | readonly number[],
    size = bytes.length,
  ) => {
    const data = new Uint8Array(size);
    data.set(bytes);
    return {
      exists: true as const,
      address,
      programAddress: REGISTRY as Address,
      data,
      space: BigInt(size),
      executable: false,
      lamports: lamports(1n),
    };
  };
  const configuration = account(
    config,
    Uint8Array.from(getKathaConfigEncoder().encode(cfg)),
  );
  const kathaId = "KATHA-PAUBHA-000001",
    reportId = "11111111-1111-4111-8111-111111111111";
  const [artwork, artworkBump] = await findArtworkPda({ kathaId });
  const art = account(
    artwork,
    Uint8Array.from(
      getArtworkRecordEncoder().encode({
        kathaId,
        artistId: reportId,
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
    ),
    246,
  );
  const [verification] = await findVerificationPda({ artwork });
  const [metadata, metadataBump] = await findInitializeMetadataHeadPda({ artwork });
  const [condition] = await findHeadPda({ artwork });
  const [custody] = await findInitializeCustodyHeadPda({ artwork });
  const [asset] = await findAssetPda({ artwork });
  const [initial] = await findReportPda({
    reportId: Uint8Array.from(Buffer.from(reportId.replaceAll("-", ""), "hex")),
  });
  const revision = wallet;
  const head = account(
    metadata,
    Uint8Array.from(
      getMetadataHeadEncoder().encode({
        artwork,
        version: 1,
        currentRevision: revision,
        currentHash: new Uint8Array(32).fill(1),
        bump: metadataBump,
      }),
    ),
  );
  // Presence snapshots here exercise reader ordering. The mint builder separately validates each attestation/Core codec.
  const rows = [
    configuration,
    art,
    account(verification, new Uint8Array(113)),
    head,
    account(condition, new Uint8Array(109)),
    account(custody, new Uint8Array(115)),
    account(initial, new Uint8Array(201)),
    account(wallet, new Uint8Array(1)),
    { exists: false as const, address: asset },
  ];
  const fetch = vi
    .mocked(fetchEncodedAccount)
    .mockReset()
    .mockResolvedValueOnce(configuration)
    .mockResolvedValueOnce(account(revision, new Uint8Array(321)));
  vi.mocked(fetchEncodedAccounts).mockReset().mockResolvedValue(rows);
  const read = createArtworkMintReaderFromRpc(
    {} as Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  );
  return { read, kathaId, reportId, cfg, configuration, rows, wallet, head, fetch };
}
it("bootstraps collection then reads mutable mint prerequisites in one finalized snapshot", async () => {
  const f = await fixture();
  const accounts = await f.read(f.kathaId, f.reportId);
  expect(accounts.assetAccount.exists).toBe(false);
  expect(accounts.initialConditionAccount.address).toBe(f.rows[6]!.address);
  expect(vi.mocked(fetchEncodedAccounts).mock.calls[0]![1]).toHaveLength(9);
  expect(vi.mocked(fetchEncodedAccounts).mock.calls[0]![2]).toMatchObject({
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
  expect(f.fetch.mock.calls[1]![1]).toBe(f.wallet);
});
it.each([0, 1, 2, 3, 4, 5, 6, 7])(
  "rejects missing prerequisite index %s",
  async (index) => {
    const f = await fixture();
    f.rows[index] = { exists: false, address: f.rows[index]!.address };
    await expect(f.read(f.kathaId, f.reportId)).rejects.toThrow();
  },
);
it.each([
  "head-owner",
  "head-discriminator",
  "collection-race",
  "revision-missing",
  "config-missing",
])("rejects %s", async (reason) => {
  const f = await fixture();
  if (reason === "head-owner") f.head.programAddress = f.wallet;
  if (reason === "head-discriminator") f.head.data[0] = 0;
  if (reason === "collection-race")
    f.configuration.data = Uint8Array.from(
      getKathaConfigEncoder().encode({
        ...f.cfg,
        collection: address("Vote111111111111111111111111111111111111111"),
      }),
    );
  if (reason === "revision-missing")
    f.fetch
      .mockReset()
      .mockResolvedValueOnce(f.configuration)
      .mockResolvedValueOnce({ exists: false, address: f.wallet });
  if (reason === "config-missing")
    f.fetch
      .mockReset()
      .mockResolvedValueOnce({ exists: false, address: f.configuration.address });
  await expect(f.read(f.kathaId, f.reportId)).rejects.toThrow();
});
