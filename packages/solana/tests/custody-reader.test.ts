import {
  address,
  fetchEncodedAccounts,
  type GetMultipleAccountsApi,
  lamports,
  type Address,
  type Rpc,
} from "@solana/kit";
import { expect, it, vi } from "vitest";
import { createCustodyReaderFromRpc } from "../src/custody-reader.js";
import {
  findConfigPda,
  findArtworkPda,
  findCollectionAuthorityPda,
  getKathaConfigEncoder,
  getArtworkRecordEncoder,
  getArtworkRecordDecoder,
  findInitializeCustodyHeadPda,
  findAssetPda,
  getCustodyHeadEncoder,
  findTransitionCustodyTransitionPda,
  CustodyState,
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
  const [custody] = await findInitializeCustodyHeadPda({ artwork });
  const [asset] = await findAssetPda({ artwork });
  const [transition] = await findTransitionCustodyTransitionPda({
    artwork,
    nextRevision: 1n,
  });
  const rows = [
    configAccount,
    artworkAccount,
    { exists: false as const, address: custody },
    { exists: false as const, address: asset },
    { exists: false as const, address: transition },
  ];
  vi.mocked(fetchEncodedAccounts).mockReset().mockResolvedValue(rows);
  const rpc = {} as Rpc<GetMultipleAccountsApi>;
  return {
    configAccount,
    rows,
    artwork,
    artworkAccount,
    kathaId,
    read: createCustodyReaderFromRpc(rpc),
    wallet,
  };
}

it("reads finalized Core/custody in one bounded snapshot, with unknown pre-mint custody", async () => {
  const f = await fixture();
  const result = await f.read(f.kathaId);
  expect(result.ownerWallet).toBeNull();
  expect(result.custodyState).toBe("UNKNOWN");
  expect(result.custodyRevision).toBe(0n);
  expect(vi.mocked(fetchEncodedAccounts).mock.calls[0]![2]).toMatchObject({
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
});
it.each(["owner", "size", "discriminator", "missing"])(
  "rejects malformed artwork %s",
  async (reason) => {
    const f = await fixture();
    if (reason === "owner")
      f.rows[1] = { ...f.artworkAccount, programAddress: f.wallet };
    if (reason === "size")
      f.rows[1] = { ...f.artworkAccount, data: new Uint8Array(1), space: 1n };
    if (reason === "discriminator") f.artworkAccount.data[0] = 0;
    if (reason === "missing") f.rows[1] = { exists: false, address: f.artwork };
    await expect(f.read(f.kathaId)).rejects.toThrow();
  },
);
it.each(["revision", "subject", "relationship", "state"])(
  "rejects malformed custody %s",
  async (reason) => {
    const f = await fixture();
    const [head, bump] = await findInitializeCustodyHeadPda({ artwork: f.artwork });
    const [transition] = await findTransitionCustodyTransitionPda({
      artwork: f.artwork,
      nextRevision: 1n,
    });
    const data = Uint8Array.from(
      getCustodyHeadEncoder().encode({
        artwork: reason === "relationship" ? f.wallet : f.artwork,
        revision: reason === "revision" ? 0n : 1n,
        state: reason === "state" ? CustodyState.Unknown : CustodyState.KathaHeld,
        subject: reason === "subject" ? null : f.wallet,
        latestTransition: transition,
        bump,
      }),
    );
    f.rows[2] = { ...f.configAccount, address: head, data, space: 115n };
    await expect(f.read(f.kathaId)).rejects.toThrow();
  },
);

it.each(["valid", "owner-program", "collection", "name", "missing"])(
  "validates bound minted Core %s",
  async (reason) => {
    const f = await fixture();
    const [asset] = await findAssetPda({ artwork: f.artwork });
    const record = getArtworkRecordDecoder().decode(f.artworkAccount.data);
    f.artworkAccount.data.set(
      getArtworkRecordEncoder().encode({ ...record, coreAsset: asset }),
    );
    const name = Buffer.from(reason === "name" ? "Wrong identity" : f.kathaId);
    const uri = Buffer.from("http://localhost/synthetic.json");
    const length = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const walletBytes = f.configAccount.data.slice(8, 40);
    const collectionBytes = Uint8Array.from(walletBytes);
    if (reason === "collection") collectionBytes[0] = collectionBytes[0]! ^ 1;
    const data = new Uint8Array(
      Buffer.concat([
        Buffer.from([1]),
        walletBytes,
        Buffer.from([2]),
        collectionBytes,
        length(name.length),
        name,
        length(uri.length),
        uri,
        Buffer.from([0]),
      ]),
    );
    f.rows[3] = {
      ...f.configAccount,
      address: asset,
      data,
      space: BigInt(data.length),
      programAddress: address(
        reason === "owner-program"
          ? f.wallet
          : "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
      ),
    };
    if (reason === "missing") f.rows[3] = { exists: false, address: asset };
    if (reason === "valid")
      expect((await f.read(f.kathaId)).ownerWallet).toBe(f.wallet);
    else await expect(f.read(f.kathaId)).rejects.toThrow();
  },
);
