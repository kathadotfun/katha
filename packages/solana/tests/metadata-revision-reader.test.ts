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
import { createMetadataRevisionReaderFromRpc } from "../src/metadata-revision-reader.js";
import {
  findConfigPda,
  findArtworkPda,
  findCollectionAuthorityPda,
  findInitializeMetadataHeadPda,
  findAssetPda,
  getKathaConfigEncoder,
  getArtworkRecordEncoder,
  getArtworkRecordDecoder,
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
  const [metadata, metadataBump] = await findInitializeMetadataHeadPda({ artwork });
  const [asset] = await findAssetPda({ artwork });
  const head = account(
    metadata,
    Uint8Array.from(
      getMetadataHeadEncoder().encode({
        artwork,
        version: 1,
        currentRevision: wallet,
        currentHash: new Uint8Array(32).fill(1),
        bump: metadataBump,
      }),
    ),
  );
  const rows = [
    configuration,
    art,
    head,
    account(wallet, new Uint8Array(1)),
    { exists: false as const, address: asset },
  ];
  const fetch = vi
    .mocked(fetchEncodedAccount)
    .mockReset()
    .mockResolvedValueOnce(configuration)
    .mockResolvedValueOnce(account(wallet, new Uint8Array(321)));
  vi.mocked(fetchEncodedAccounts).mockReset().mockResolvedValue(rows);
  const read = createMetadataRevisionReaderFromRpc(
    {} as Rpc<GetAccountInfoApi & GetMultipleAccountsApi>,
  );
  const mint = () => {
    const data = new Uint8Array(246);
    data.set(
      getArtworkRecordEncoder().encode({
        ...getArtworkRecordDecoder().decode(art.data),
        coreAsset: asset,
      }),
    );
    art.data = data;
    rows[4] = account(asset, new Uint8Array(1));
  };
  return { read, kathaId, cfg, configuration, rows, wallet, head, fetch, mint };
}
it("reads five mutable prerequisites together and immutable revision separately", async () => {
  const f = await fixture();
  const result = await f.read(f.kathaId);
  expect(result.mode).toBe("UNMINTED");
  expect(vi.mocked(fetchEncodedAccounts).mock.calls[0]![1]).toHaveLength(5);
  expect(vi.mocked(fetchEncodedAccounts).mock.calls[0]![2]).toMatchObject({
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
  expect(f.fetch.mock.calls[1]![1]).toBe(f.wallet);
});
it("permits first commitment only with an absent head and unbound absent asset", async () => {
  const f = await fixture();
  f.rows[2] = { exists: false, address: f.head.address };
  expect((await f.read(f.kathaId)).mode).toBe("INITIALIZE");
  expect(f.fetch).toHaveBeenCalledTimes(1);
});
it("returns bound Core snapshots for minted revisions", async () => {
  const f = await fixture();
  f.mint();
  expect((await f.read(f.kathaId)).mode).toBe("MINTED");
});
it.each([
  "missing-config",
  "missing-artwork",
  "head-owner",
  "head-discriminator",
  "collection-race",
  "missing-revision",
  "minted-missing-head",
  "minted-missing-collection",
  "minted-missing-asset",
  "unbound-existing-asset",
])("rejects %s", async (reason) => {
  const f = await fixture();
  if (reason === "missing-config")
    f.rows[0] = { exists: false, address: f.rows[0]!.address };
  if (reason === "missing-artwork")
    f.rows[1] = { exists: false, address: f.rows[1]!.address };
  if (reason === "head-owner") f.head.programAddress = f.wallet;
  if (reason === "head-discriminator") f.head.data[0] = 0;
  if (reason === "collection-race")
    f.configuration.data = Uint8Array.from(
      getKathaConfigEncoder().encode({
        ...f.cfg,
        collection: address("Vote111111111111111111111111111111111111111"),
      }),
    );
  if (reason === "missing-revision")
    f.fetch
      .mockReset()
      .mockResolvedValueOnce(f.configuration)
      .mockResolvedValueOnce({ exists: false, address: f.wallet });
  if (reason.startsWith("minted")) f.mint();
  if (reason === "minted-missing-head")
    f.rows[2] = { exists: false, address: f.head.address };
  if (reason === "minted-missing-collection")
    f.rows[3] = { exists: false, address: f.wallet };
  if (reason === "minted-missing-asset")
    f.rows[4] = { exists: false, address: f.rows[4]!.address };
  if (reason === "unbound-existing-asset")
    f.rows[4] = { ...f.head, address: f.rows[4]!.address };
  await expect(f.read(f.kathaId)).rejects.toThrow();
});
