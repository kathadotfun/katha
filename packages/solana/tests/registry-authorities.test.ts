import {
  address,
  blockhash,
  fetchEncodedAccount,
  lamports,
  SolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Address,
} from "@solana/kit";
import { afterEach, expect, it, vi } from "vitest";
import * as rpcClient from "../src/client.js";
import {
  findConfigPda,
  findCollectionAuthorityPda,
  findGovernancePda,
  getKathaConfigEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  type KathaConfigArgs,
} from "../src/generated/registry/index.js";
import {
  createRegistryAuthorityReader,
  createRegistryCollectionReader,
  readRegistryAuthorities,
} from "../src/registry-authorities.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(fetchEncodedAccount).mockReset();
});

function rateLimit() {
  return new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    statusCode: 429,
    message: "Synthetic rate limit",
    headers: new Headers(),
  });
}

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

it("shares only in-flight permission reads for the same wallet and refreshes after completion", async () => {
  const { account, state } = await fixture();
  const fetch = vi.mocked(fetchEncodedAccount);
  fetch.mockResolvedValue(account);
  const read = createRegistryAuthorityReader({ cluster: "localnet" });
  const first = read(ADMIN);
  const concurrent = read(ADMIN);
  expect(concurrent).toBe(first);
  await Promise.all([first, concurrent]);
  expect(fetch).toHaveBeenCalledTimes(1);
  state.registrationAuthority = VERIFIER;
  account.data = Uint8Array.from(getKathaConfigEncoder().encode(state));
  expect((await read(ADMIN)).registrationAuthority).toBe(VERIFIER);
  expect(fetch).toHaveBeenCalledTimes(2);
  await Promise.all([read(ADMIN), read(VERIFIER)]);
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("discards a failed in-flight read before the next permission check", async () => {
  const { account } = await fixture();
  const fetch = vi.mocked(fetchEncodedAccount);
  fetch
    .mockRejectedValueOnce(new Error("Synthetic transport failure"))
    .mockResolvedValue(account);
  const read = createRegistryAuthorityReader({ cluster: "localnet" });
  const failed = await Promise.allSettled([read(ADMIN), read(ADMIN)]);
  expect(failed.every((result) => result.status === "rejected")).toBe(true);
  expect((await read(ADMIN)).registrationAuthority).toBe(ADMIN);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("binds collection filters to fresh finalized validated configuration", async () => {
  const { account, state } = await fixture();
  const fetch = vi.mocked(fetchEncodedAccount);
  fetch.mockResolvedValue(account);
  const read = createRegistryCollectionReader({ cluster: "localnet" });
  expect(await read()).toBe(VERIFIER);
  expect(fetch).toHaveBeenLastCalledWith(expect.anything(), account.address, {
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
  fetch.mockResolvedValueOnce({ exists: false, address: account.address });
  await expect(read()).rejects.toThrow("not initialized");
  state.collection = SYSTEM;
  account.data = Uint8Array.from(getKathaConfigEncoder().encode(state));
  fetch.mockResolvedValueOnce(account);
  await expect(read()).rejects.toThrow();
  account.programAddress = SYSTEM;
  fetch.mockResolvedValueOnce(account);
  await expect(read()).rejects.toThrow();
});

it("recovers a rate-limited configuration read without accepting a forged replacement", async () => {
  const { account } = await fixture();
  const fetch = vi.mocked(fetchEncodedAccount);
  fetch.mockRejectedValueOnce(rateLimit()).mockResolvedValue(account);
  const read = createRegistryAuthorityReader({ cluster: "localnet" });
  expect((await read()).registrationAuthority).toBe(ADMIN);
  expect(fetch).toHaveBeenCalledTimes(2);
  account.programAddress = SYSTEM;
  await expect(read()).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("retries genesis transport but rejects a wrong network before reading grants", async () => {
  const { account, state } = await fixture();
  state.registrationAuthority = (await findGovernancePda())[0];
  account.data = Uint8Array.from(getKathaConfigEncoder().encode(state));
  vi.mocked(fetchEncodedAccount).mockResolvedValue(account);
  const client = rpcClient.createKathaRpcClient({ cluster: "devnet" });
  const genesis = vi
    .fn()
    .mockRejectedValueOnce(rateLimit())
    .mockResolvedValue(blockhash("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"));
  vi.spyOn(rpcClient, "createKathaRpcClient").mockReturnValue({
    ...client,
    rpc: {
      ...client.rpc,
      getGenesisHash: () => ({ ...client.rpc.getGenesisHash(), send: genesis }),
    },
  });
  const read = createRegistryAuthorityReader({ cluster: "devnet" });
  await expect(read(ADMIN)).rejects.toThrow("cluster mismatch");
  expect(genesis).toHaveBeenCalledTimes(2);
  expect(fetchEncodedAccount).toHaveBeenCalledTimes(1);
});
