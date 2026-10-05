import {
  address,
  fetchEncodedAccount,
  lamports,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import { expect, it, vi } from "vitest";
import { createArtworkVerificationReaderFromRpc } from "../src/artwork-verification-reader.js";
import {
  findConfigPda,
  findArtworkPda,
  findCollectionAuthorityPda,
  getKathaConfigEncoder,
  getArtworkRecordEncoder,
  findVerificationPda,
  ArtworkCategory,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
} from "../src/generated/registry/index.js";
vi.mock("@solana/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@solana/kit")>()),
  fetchEncodedAccount: vi.fn(),
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
  const rpc = {} as Rpc<GetAccountInfoApi>;
  return {
    configAccount,
    artwork,
    artworkAccount,
    verification,
    kathaId,
    mock,
    read: createArtworkVerificationReaderFromRpc(rpc),
    wallet,
  };
}
it("reads derived config/artwork accounts at finalized commitment with a deadline", async () => {
  const f = await fixture();
  const result = await f.read(f.kathaId);
  expect(result.verificationExists).toBe(false);
  expect(result.verificationAddress).toBe(f.verification);
  expect(f.mock.mock.calls.map((call) => call[1])).toEqual([
    f.configAccount.address,
    f.artwork,
    f.verification,
  ]);
  expect(
    f.mock.mock.calls.every(
      (call) =>
        call[2]?.commitment === "finalized" &&
        call[2]?.abortSignal instanceof AbortSignal,
    ),
  ).toBe(true);
});
it("reports an occupied verification PDA regardless of its owner", async () => {
  const f = await fixture();
  f.mock
    .mockReset()
    .mockResolvedValueOnce(f.configAccount)
    .mockResolvedValueOnce(f.artworkAccount)
    .mockResolvedValueOnce({ ...f.configAccount, address: f.verification });
  expect((await f.read(f.kathaId)).verificationExists).toBe(true);
});
it.each([
  "missing-config",
  "owner",
  "address",
  "discriminator",
  "missing-artwork",
  "artwork-owner",
  "artwork-discriminator",
  "verification-address",
])("fails closed on %s", async (reason) => {
  const f = await fixture();
  f.mock.mockReset();
  const config = { ...f.configAccount, data: new Uint8Array(f.configAccount.data) };
  if (reason === "owner") config.programAddress = f.wallet;
  if (reason === "address") config.address = f.wallet;
  if (reason === "discriminator") config.data[0] = 0;
  f.mock.mockResolvedValueOnce(
    reason === "missing-config" ? { exists: false, address: config.address } : config,
  );
  const artwork = { ...f.artworkAccount, data: new Uint8Array(f.artworkAccount.data) };
  if (reason === "artwork-owner") artwork.programAddress = f.wallet;
  if (reason === "artwork-discriminator") artwork.data[0] = 0;
  f.mock.mockResolvedValueOnce(
    reason === "missing-artwork" ? { exists: false, address: f.artwork } : artwork,
  );
  f.mock.mockResolvedValueOnce({
    exists: false,
    address: reason === "verification-address" ? f.wallet : f.verification,
  });
  await expect(f.read(f.kathaId)).rejects.toThrow();
});
it("propagates RPC unavailability without assuming an absent artwork", async () => {
  const f = await fixture();
  f.mock.mockReset().mockRejectedValue(new Error("RPC offline"));
  await expect(f.read(f.kathaId)).rejects.toThrow("RPC offline");
});
