import { getCollectionV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js";
import { Key } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import {
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  type Address,
  type Instruction,
  type MaybeEncodedAccount,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  prepareDevnetBootstrapInstruction,
  readBootstrapProgram,
  DEVNET_TEST_SETTINGS,
} from "../src/devnet-bootstrap.js";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
import * as reg from "../src/generated/registry/index.js";
import * as market from "../src/generated/marketplace/index.js";

const loader = address("BPFLoaderUpgradeab1e11111111111111111111111");
const operator = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const collection = address("Vote111111111111111111111111111111111111111");
const treasury = address("SysvarRent111111111111111111111111111111111");
const mint = address("So11111111111111111111111111111111111111112");
const config = {
  cluster: "devnet",
  operator,
  collection,
  collectionUri: "https://katha.fun/test/collection.json",
  registrationAuthority: operator,
  verifierAuthority: treasury,
  custodyAuthority: operator,
  treasury,
  paymentMint: mint,
};
const sale = { kathaId: "KATHA-PAUBHA-000001", artistPayout: treasury };
function checkedInstruction(instruction: Instruction) {
  if (!instruction.accounts || !instruction.data)
    throw new Error("Incomplete bootstrap instruction");
  return { ...instruction, accounts: instruction.accounts, data: instruction.data };
}
function account(
  key: Address,
  owner: Address,
  data: Uint8Array,
  executable = false,
): MaybeEncodedAccount {
  return {
    exists: true,
    address: key,
    programAddress: owner,
    data,
    executable,
    space: BigInt(data.length),
    lamports: lamports(1_000_000n),
  };
}
async function fixture() {
  const entries = new Map<Address, MaybeEncodedAccount>();
  const put = (key: Address, owner: Address, data: Uint8Array, executable = false) =>
    entries.set(key, account(key, owner, data, executable));
  for (const program of [
    reg.KATHA_REGISTRY_PROGRAM_ADDRESS,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  ]) {
    const [dataAddress] = await getProgramDerivedAddress({
      programAddress: loader,
      seeds: [getAddressEncoder().encode(program)],
    });
    const programData = new Uint8Array(36),
      authorityData = new Uint8Array(45);
    new DataView(programData.buffer).setUint32(0, 2, true);
    programData.set(getAddressEncoder().encode(dataAddress), 4);
    new DataView(authorityData.buffer).setUint32(0, 3, true);
    authorityData[12] = 1;
    authorityData.set(getAddressEncoder().encode(operator), 13);
    put(program, loader, programData, true);
    put(dataAddress, loader, authorityData);
  }
  put(CORE_PROGRAM_ADDRESS, loader, new Uint8Array(36), true);
  const [registryConfig, bump] = await reg.findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await reg.findCollectionAuthorityPda();
  const [marketConfig, marketBump] = await market.findConfigPda();
  const [artwork, artworkBump] = await reg.findArtworkPda({ kathaId: sale.kathaId });
  const [saleTerms] = await market.findSaleTermsPda({ artwork });
  const installCollection = () =>
    put(
      collection,
      CORE_PROGRAM_ADDRESS,
      getCollectionV1AccountDataSerializer().serialize({
        key: Key.CollectionV1,
        updateAuthority: publicKey(collectionAuthority),
        name: "Synthetic test collection",
        uri: config.collectionUri,
        numMinted: 0,
        currentSize: 0,
      }),
    );
  const installRegistry = () =>
    put(
      registryConfig,
      reg.KATHA_REGISTRY_PROGRAM_ADDRESS,
      Uint8Array.from(
        reg.getKathaConfigEncoder().encode({
          authority: operator,
          registrationAuthority: operator,
          verifierAuthority: treasury,
          custodyAuthority: operator,
          treasury,
          collection,
          collectionAuthority,
          bump,
          collectionAuthorityBump,
        }),
      ),
    );
  const installMarket = () =>
    put(
      marketConfig,
      market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
      Uint8Array.from(
        market.getMarketplaceConfigEncoder().encode({
          version: 1,
          authority: operator,
          registryProgram: reg.KATHA_REGISTRY_PROGRAM_ADDRESS,
          registryConfig,
          collection,
          treasury,
          paymentMint: mint,
          tokenProgram: operator,
          paymentDecimals: 6,
          ...DEVNET_TEST_SETTINGS,
          bump: marketBump,
        }),
      ),
    );
  const installArtwork = () =>
    put(
      artwork,
      reg.KATHA_REGISTRY_PROGRAM_ADDRESS,
      Uint8Array.from(
        reg.getArtworkRecordEncoder().encode({
          kathaId: sale.kathaId,
          artistId: "123e4567-e89b-42d3-a456-426614174000",
          creatorWallet: null,
          category: reg.ArtworkCategory.Paubha,
          creationYear: 2025,
          authorshipEvidenceHash: new Uint8Array(32).fill(7),
          collection,
          coreAsset: null,
          registeredBy: operator,
          registeredAt: 1n,
          bump: artworkBump,
        }),
      ),
    );
  const mintBytes = new Uint8Array(82);
  mintBytes[44] = 6;
  mintBytes[45] = 1;
  put(mint, operator, mintBytes);
  const read = async (key: Address): Promise<MaybeEncodedAccount> =>
    entries.get(key) ?? { exists: false, address: key };
  return {
    entries,
    put,
    read,
    registryConfig,
    marketConfig,
    collectionAuthority,
    artwork,
    saleTerms,
    mintBytes,
    installCollection,
    installRegistry,
    installMarket,
    installArtwork,
  };
}

describe("Devnet operator bootstrap", () => {
  it("constructs each generated operation in lifecycle order with canonical addresses", async () => {
    const f = await fixture();
    const first = await prepareDevnetBootstrapInstruction("collection", config, f.read);
    expect(first.programAddress).toBe(CORE_PROGRAM_ADDRESS);
    expect(first.accounts?.some((a) => a.address === collection && a.role === 3)).toBe(
      true,
    );
    f.installCollection();
    const registry = reg.parseInitializePlatformInstruction(
      checkedInstruction(
        await prepareDevnetBootstrapInstruction("registry", config, f.read),
      ),
    );
    expect(registry.data.verifierAuthority).toBe(treasury);
    f.installRegistry();
    const marketplace = market.parseInitializeMarketplaceInstruction(
      checkedInstruction(
        await prepareDevnetBootstrapInstruction("marketplace", config, f.read),
      ),
    );
    expect(marketplace.data).toMatchObject(DEVNET_TEST_SETTINGS);
    f.installMarket();
    f.installArtwork();
    const terms = market.parseInitializeSaleTermsInstruction(
      checkedInstruction(
        await prepareDevnetBootstrapInstruction("sale-terms", config, f.read, sale),
      ),
    );
    expect(terms.data.artistPayout).toBe(treasury);
    expect(terms.accounts.artwork.address).toBe(f.artwork);
  });
  it("rejects duplicate collection/config/terms initialization", async () => {
    const f = await fixture();
    f.installCollection();
    await expect(
      prepareDevnetBootstrapInstruction("collection", config, f.read),
    ).rejects.toThrow(/already exists/);
    f.installRegistry();
    await expect(
      prepareDevnetBootstrapInstruction("registry", config, f.read),
    ).rejects.toThrow(/already exists/);
    f.installMarket();
    await expect(
      prepareDevnetBootstrapInstruction("marketplace", config, f.read),
    ).rejects.toThrow(/already exists/);
    f.installArtwork();
    f.put(f.saleTerms, market.KATHA_MARKETPLACE_PROGRAM_ADDRESS, new Uint8Array(8));
    await expect(
      prepareDevnetBootstrapInstruction("sale-terms", config, f.read, sale),
    ).rejects.toThrow(/already exists/);
  });
  it("rejects wrong upgrade authority, forged loader pointer and missing Core", async () => {
    const f = await fixture();
    await expect(
      readBootstrapProgram(reg.KATHA_REGISTRY_PROGRAM_ADDRESS, f.read, treasury),
    ).rejects.toThrow();
    const program = await f.read(reg.KATHA_REGISTRY_PROGRAM_ADDRESS);
    if (!program.exists) throw new Error("fixture missing");
    const bad = Uint8Array.from(program.data);
    bad.set(getAddressEncoder().encode(collection), 4);
    f.put(program.address, loader, bad, true);
    await expect(
      prepareDevnetBootstrapInstruction("collection", config, f.read),
    ).rejects.toThrow();
    f.entries.delete(CORE_PROGRAM_ADDRESS);
    await expect(
      prepareDevnetBootstrapInstruction("collection", config, f.read),
    ).rejects.toThrow(/Core/);
  });
  it("rejects mismatched roles, collections, and forged config ownership", async () => {
    const f = await fixture();
    f.installCollection();
    const c = await f.read(collection);
    if (!c.exists) throw new Error("fixture missing");
    f.put(collection, loader, Uint8Array.from(c.data));
    await expect(
      prepareDevnetBootstrapInstruction("registry", config, f.read),
    ).rejects.toThrow();
    f.installRegistry();
    await expect(
      prepareDevnetBootstrapInstruction(
        "marketplace",
        { ...config, verifierAuthority: operator },
        f.read,
      ),
    ).rejects.toThrow(/inputs/);
    const r = await f.read(f.registryConfig);
    if (!r.exists) throw new Error("fixture missing");
    f.put(f.registryConfig, loader, Uint8Array.from(r.data));
    await expect(
      prepareDevnetBootstrapInstruction("marketplace", config, f.read),
    ).rejects.toThrow();
  });
  it.each(["decimals", "freeze", "uninitialized", "owner", "size"])(
    "rejects %s test mint",
    async (kind) => {
      const f = await fixture();
      f.installRegistry();
      const bytes = Uint8Array.from(f.mintBytes);
      if (kind === "decimals") bytes[44] = 9;
      if (kind === "freeze") bytes[46] = 1;
      if (kind === "uninitialized") bytes[45] = 0;
      f.put(
        mint,
        kind === "owner" ? loader : operator,
        kind === "size" ? bytes.subarray(0, 81) : bytes,
      );
      await expect(
        prepareDevnetBootstrapInstruction("marketplace", config, f.read),
      ).rejects.toThrow();
    },
  );
  it("rejects forged artwork, payout defaults and public inputs containing secrets", async () => {
    const f = await fixture();
    f.installRegistry();
    f.installMarket();
    f.installArtwork();
    const art = await f.read(f.artwork);
    if (!art.exists) throw new Error("fixture missing");
    f.put(f.artwork, loader, Uint8Array.from(art.data));
    await expect(
      prepareDevnetBootstrapInstruction("sale-terms", config, f.read, sale),
    ).rejects.toThrow();
    f.installArtwork();
    await expect(
      prepareDevnetBootstrapInstruction("sale-terms", config, f.read, {
        ...sale,
        artistPayout: "11111111111111111111111111111111",
      }),
    ).rejects.toThrow();
    await expect(
      prepareDevnetBootstrapInstruction(
        "collection",
        { ...config, privateKey: "never accepted" },
        f.read,
      ),
    ).rejects.toThrow();
    await expect(
      prepareDevnetBootstrapInstruction(
        "collection",
        { ...config, cluster: "mainnet" },
        f.read,
      ),
    ).rejects.toThrow();
  });
});

it("prepares editable fees from public inputs with a fresh reviewed revision", async () => {
  const f = await fixture();
  f.installRegistry();
  f.installMarket();
  const feeRates = {
    primaryCommissionBps: 1000,
    secondaryCommissionBps: 250,
    secondaryRoyaltyBps: 500,
  };
  const created = market.parseInitializeFeeScheduleInstruction(
    checkedInstruction(
      await prepareDevnetBootstrapInstruction("fees", { ...config, feeRates }, f.read),
    ),
  );
  expect(created.data).toMatchObject(feeRates);
  const [feeSchedule, bump] = await market.findFeeSchedulePda();
  f.put(
    feeSchedule,
    market.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
    Uint8Array.from(
      market.getFeeScheduleEncoder().encode({
        version: 1,
        config: f.marketConfig,
        revision: 7n,
        bump,
        ...feeRates,
      }),
    ),
  );
  await expect(
    prepareDevnetBootstrapInstruction("fees", config, f.read),
  ).rejects.toThrow(/already exists/);
  const changedRates = {
    primaryCommissionBps: 1200,
    secondaryCommissionBps: 200,
    secondaryRoyaltyBps: 400,
  };
  const updated = market.parseUpdateFeeScheduleInstruction(
    checkedInstruction(
      await prepareDevnetBootstrapInstruction(
        "update-fees",
        { ...config, feeRates: changedRates },
        f.read,
      ),
    ),
  );
  expect(updated.data).toMatchObject({ ...changedRates, expectedRevision: 7n });
  await expect(
    prepareDevnetBootstrapInstruction(
      "update-fees",
      {
        ...config,
        feeRates: { ...feeRates, secondaryRoyaltyBps: 10000 },
      },
      f.read,
    ),
  ).rejects.toThrow();
});
