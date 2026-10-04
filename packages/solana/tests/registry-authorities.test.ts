import { address, fetchEncodedAccount, lamports, type Address } from "@solana/kit";
import { expect, it, vi } from "vitest";
import {
  findConfigPda,
  findCollectionAuthorityPda,
  getKathaConfigEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  type KathaConfigArgs,
} from "../src/generated/registry/index.js";
import {
  createRegistryAuthorityReader,
  readRegistryAuthorities,
} from "../src/registry-authorities.js";

vi.mock("@solana/kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@solana/kit")>()),
  fetchEncodedAccount: vi.fn(),
}));
const ADMIN = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const VERIFIER = address("Vote111111111111111111111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
async function fixture() {
  const [config, bump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const state: KathaConfigArgs = {
    authority: ADMIN,
    registrationAuthority: ADMIN,
    verifierAuthority: VERIFIER,
    custodyAuthority: ADMIN,
    treasury: ADMIN,
    collection: VERIFIER,
    collectionAuthority,
    bump,
    collectionAuthorityBump,
  };
  const data = Uint8Array.from(getKathaConfigEncoder().encode(state));
  const account = {
    exists: true as const,
    address: config,
    programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS as Address,
    data,
    space: BigInt(data.length),
    lamports: lamports(1000000n),
    executable: false,
  };
  return { account, state };
}
it("reads only validated canonical Registry authorities", async () => {
  const f = await fixture();
  expect(await readRegistryAuthorities(f.account)).toEqual({
    authority: ADMIN,
    registrationAuthority: ADMIN,
    verifierAuthority: VERIFIER,
    custodyAuthority: ADMIN,
  });
});
it.each([
  "owner",
  "address",
  "discriminator",
  "length",
  "executable",
  "bump",
  "collection-authority",
  "collection-bump",
  "zero-authority",
])("rejects forged %s", async (failure) => {
  const { account, state } = await fixture();
  switch (failure) {
    case "owner":
      account.programAddress = SYSTEM;
      break;
    case "address":
      account.address = ADMIN;
      break;
    case "discriminator":
      account.data[0] = account.data[0]! ^ 255;
      break;
    case "length":
      account.data = account.data.slice(0, -1);
      account.space = BigInt(account.data.length);
      break;
    case "executable":
      account.executable = true;
      break;
    case "bump":
      state.bump ^= 1;
      break;
    case "collection-authority":
      state.collectionAuthority = ADMIN;
      break;
    case "collection-bump":
      state.collectionAuthorityBump ^= 1;
      break;
    case "zero-authority":
      state.verifierAuthority = SYSTEM;
      break;
  }
  if (
    ["bump", "collection-authority", "collection-bump", "zero-authority"].includes(
      failure,
    )
  )
    account.data = Uint8Array.from(getKathaConfigEncoder().encode(state));
  await expect(readRegistryAuthorities(account)).rejects.toThrow();
});
it("fetches finalized configuration on every read with a bounded abort signal", async () => {
  const { account } = await fixture();
  const fetch = vi.mocked(fetchEncodedAccount);
  fetch.mockResolvedValue(account);
  const read = createRegistryAuthorityReader({ cluster: "localnet" });
  await read();
  await read();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith(expect.anything(), account.address, {
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
  fetch.mockResolvedValueOnce({ exists: false, address: account.address });
  await expect(read()).rejects.toThrow("not initialized");
  fetch.mockRejectedValueOnce(new Error("RPC failure"));
  await expect(read()).rejects.toThrow("RPC failure");
});
