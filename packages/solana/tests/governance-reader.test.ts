import { afterEach, expect, it, vi } from "vitest";
import {
  address,
  fetchEncodedAccounts,
  generateKeyPairSigner,
  lamports,
  SolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type EncodedAccount,
  type MaybeEncodedAccount,
  type GetMultipleAccountsApi,
  type Rpc,
} from "@solana/kit";
import * as registry from "../src/generated/registry/index.js";
import * as market from "../src/generated/marketplace/index.js";
import {
  REGISTRY_GOVERNANCE_SIZE,
  inspectGovernanceSuffix,
  readOperatorAuthorization,
} from "../src/governance.js";
vi.mock("@solana/kit", async (original) => ({
  ...(await original<typeof import("@solana/kit")>()),
  fetchEncodedAccounts: vi.fn(),
}));
const rpc = {} as Rpc<GetMultipleAccountsApi>;

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(fetchEncodedAccounts).mockReset();
});

async function fixture() {
  const wallet = (await generateKeyPairSigner()).address;
  const [
    [config, configBump],
    [governance, bump],
    [grant, grantBump],
    [collectionAuthority, collectionAuthorityBump],
    [marketConfig],
  ] = await Promise.all([
    registry.findConfigPda(),
    registry.findGovernancePda(),
    registry.findGrantPda({ wallet }),
    registry.findCollectionAuthorityPda(),
    market.findConfigPda(),
  ]);
  function account(key: typeof wallet, bytes: ArrayLike<number>, size = bytes.length) {
    const data = new Uint8Array(size);
    data.set(bytes);
    return {
      address: key,
      programAddress: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
      data,
      executable: false,
      lamports: lamports(10000000n),
      space: BigInt(data.length),
    };
  }
  const configuration = {
    authority: wallet,
    registrationAuthority: governance,
    verifierAuthority: wallet,
    custodyAuthority: wallet,
    treasury: wallet,
    collection: wallet,
    collectionAuthority,
    collectionAuthorityBump,
    bump: Number(configBump),
  };
  const governanceState = {
    version: 1,
    config,
    marketplaceProgram: market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    marketplaceConfig: marketConfig,
    legacyRegistrar: wallet,
    custodyIdentity: wallet,
    revision: 1n,
    pauses: 0,
    holds: [],
    bump,
  };
  const grantState = {
    version: 1,
    governance,
    wallet,
    roles: 4,
    enabled: true,
    expiresAt: 0n,
    revision: 1n,
    changedBy: wallet,
    changedAt: 100n,
    changedSlot: 10n,
    bump: grantBump,
  };
  const clockBytes = new Uint8Array(40);
  const view = new DataView(clockBytes.buffer);
  view.setBigUint64(0, 20n, true);
  view.setBigInt64(32, 200n, true);
  const clock = {
    ...account(address("SysvarC1ock11111111111111111111111111111111"), clockBytes),
    programAddress: address("Sysvar1111111111111111111111111111111111111"),
  };
  function accounts(): MaybeEncodedAccount[] {
    return [
      {
        ...account(config, registry.getKathaConfigEncoder().encode(configuration)),
        exists: true,
      },
      {
        ...account(
          governance,
          registry.getRegistryGovernanceEncoder().encode(governanceState),
          REGISTRY_GOVERNANCE_SIZE,
        ),
        exists: true,
      },
      {
        ...account(grant, registry.getRoleGrantEncoder().encode(grantState)),
        exists: true,
      },
      { ...clock, exists: true },
    ];
  }
  return {
    wallet,
    governance,
    grant,
    config,
    grantState,
    governanceState,
    configuration,
    accounts,
  };
}

it("reads all grant, governance and clock accounts from one finalized bank; expiry and revocation remove permission", async () => {
  const f = await fixture();
  const fetch = vi.mocked(fetchEncodedAccounts);
  fetch.mockImplementation(async () => f.accounts());
  expect(await readOperatorAuthorization(rpc, f.wallet)).toMatchObject({
    roles: 4,
    slot: 20n,
  });
  f.grantState.enabled = false;
  expect((await readOperatorAuthorization(rpc, f.wallet)).roles).toBe(0);
  f.grantState.enabled = true;
  f.grantState.expiresAt = 200n;
  expect((await readOperatorAuthorization(rpc, f.wallet)).roles).toBe(0);
  expect(fetch).toHaveBeenLastCalledWith(rpc, expect.any(Array), {
    commitment: "finalized",
    abortSignal: expect.any(AbortSignal),
  });
});

it("retries the whole finalized bank read and observes revocation during recovery", async () => {
  const f = await fixture();
  const fetch = vi.mocked(fetchEncodedAccounts);
  fetch.mockImplementationOnce(async () => {
    f.grantState.enabled = false;
    throw new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
      statusCode: 429,
      message: "Synthetic rate limit",
      headers: new Headers(),
    });
  });
  fetch.mockImplementation(async () => f.accounts());
  expect((await readOperatorAuthorization(rpc, f.wallet)).roles).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("cancels a rate-limited permission read without scheduling another bank read", async () => {
  const f = await fixture();
  const fetch = vi.mocked(fetchEncodedAccounts);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  fetch.mockImplementation(async () => {
    entered();
    throw new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
      statusCode: 429,
      message: "Synthetic rate limit",
      headers: new Headers(),
    });
  });
  const controller = new AbortController();
  const rejected = expect(
    readOperatorAuthorization(rpc, f.wallet, controller.signal),
  ).rejects.toThrow("Synthetic cancellation");
  await started;
  controller.abort(new Error("Synthetic cancellation"));
  await rejected;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  "governance-owner",
  "grant-owner",
  "grant-address",
  "discriminator",
  "allocation",
  "wallet",
  "roles",
  "version",
  "custody",
  "config-bump",
  "inactive",
  "clock",
])("rejects forged %s", async (fault) => {
  const f = await fixture();
  if (fault === "wallet") f.grantState.wallet = f.config;
  if (fault === "roles") f.grantState.roles = 128;
  if (fault === "version") f.governanceState.version = 0;
  if (fault === "custody") f.governanceState.custodyIdentity = f.config;
  if (fault === "config-bump") f.configuration.bump ^= 1;
  if (fault === "inactive") f.configuration.registrationAuthority = f.wallet;
  const accounts = f.accounts();
  const mutate = (i: number, input: Partial<EncodedAccount>) => {
    accounts[i] = { ...accounts[i]!, ...input, exists: true } as MaybeEncodedAccount;
  };
  if (fault === "governance-owner") mutate(1, { programAddress: f.wallet });
  if (fault === "grant-owner") mutate(2, { programAddress: f.wallet });
  if (fault === "grant-address") mutate(2, { address: f.config });
  if (fault === "clock") mutate(3, { programAddress: f.wallet });
  if (fault === "discriminator") {
    const a = accounts[1]!;
    if (!a.exists) throw new Error();
    a.data[0] = a.data[0]! ^ 1;
  }
  if (fault === "allocation") {
    const a = accounts[1]!;
    if (!a.exists) throw new Error();
    mutate(1, { data: a.data.slice(0, -1) });
  }
  vi.mocked(fetchEncodedAccounts).mockResolvedValue(accounts);
  await expect(readOperatorAuthorization(rpc, f.wallet)).rejects.toThrow();
});

it("browser account extension binds the exact wallet grant, order and read-only privileges", async () => {
  const f = await fixture();
  const instruction = {
    programAddress: registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    accounts: [f.wallet, f.governance, f.grant, f.config].map((key) => ({
      address: key,
      role: 0 as const,
    })),
    data: new Uint8Array(8),
  };
  const checked = await inspectGovernanceSuffix(instruction, f.wallet);
  expect(checked.governed).toBe(true);
  expect(checked.instruction.accounts).toHaveLength(1);
  for (const suffix of [
    [f.governance, f.config, f.grant],
    [f.governance, f.wallet, f.config],
  ]) {
    await expect(
      inspectGovernanceSuffix(
        { ...instruction, accounts: suffix.map((key) => ({ address: key, role: 0 })) },
        f.wallet,
      ),
    ).rejects.toThrow();
  }
  await expect(
    inspectGovernanceSuffix(
      {
        ...instruction,
        accounts: instruction.accounts.map((a, i) => ({ ...a, role: i === 2 ? 1 : 0 })),
      },
      f.wallet,
    ),
  ).rejects.toThrow();
});
