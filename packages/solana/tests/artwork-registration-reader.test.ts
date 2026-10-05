import {
  address,
  fetchEncodedAccount,
  lamports,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from "@solana/kit";
import { expect, it, vi } from "vitest";
import { createArtworkRegistrationReaderFromRpc } from "../src/artwork-registration-reader.js";
import {
  findConfigPda,
  findArtworkPda,
  findCollectionAuthorityPda,
  getKathaConfigEncoder,
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
  const [artwork] = await findArtworkPda({ kathaId });
  vi.mocked(fetchEncodedAccount).mockReset();
  const mock = vi
    .mocked(fetchEncodedAccount)
    .mockResolvedValueOnce(configAccount)
    .mockResolvedValueOnce({ exists: false, address: artwork });
  const rpc = {} as Rpc<GetAccountInfoApi>;
  return {
    configAccount,
    artwork,
    kathaId,
    mock,
    read: createArtworkRegistrationReaderFromRpc(rpc),
    wallet,
  };
}
it("reads derived config/artwork accounts at finalized commitment with a deadline", async () => {
  const f = await fixture();
  const result = await f.read(f.kathaId);
  expect(result.artworkExists).toBe(false);
  expect(result.artworkAddress).toBe(f.artwork);
  expect(f.mock.mock.calls.map((call) => call[1])).toEqual([
    f.configAccount.address,
    f.artwork,
  ]);
  expect(
    f.mock.mock.calls.every(
      (call) =>
        call[2]?.commitment === "finalized" &&
        call[2]?.abortSignal instanceof AbortSignal,
    ),
  ).toBe(true);
});
it("reports an occupied artwork address without treating it as an unregistered identity", async () => {
  const f = await fixture();
  f.mock
    .mockReset()
    .mockResolvedValueOnce(f.configAccount)
    .mockResolvedValueOnce({ ...f.configAccount, address: f.artwork });
  expect((await f.read(f.kathaId)).artworkExists).toBe(true);
});
it.each([
  "missing-config",
  "owner",
  "address",
  "discriminator",
  "missing-artwork-address",
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
  f.mock.mockResolvedValueOnce({
    exists: false,
    address: reason === "missing-artwork-address" ? f.wallet : f.artwork,
  });
  await expect(f.read(f.kathaId)).rejects.toThrow();
});
it("propagates RPC unavailability without assuming an absent artwork", async () => {
  const f = await fixture();
  f.mock.mockReset().mockRejectedValue(new Error("RPC offline"));
  await expect(f.read(f.kathaId)).rejects.toThrow("RPC offline");
});
