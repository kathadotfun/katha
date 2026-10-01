import { getCollectionV1AccountDataSerializer } from "@metaplex-foundation/mpl-core/dist/src/generated/types/collectionV1AccountData.js";
import { Key } from "@metaplex-foundation/mpl-core";
import { publicKey } from "@metaplex-foundation/umi";
import {
  AccountRole,
  address,
  blockhash,
  compileTransaction,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
  type Address,
  type EncodedAccount,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
import {
  ArtworkCategory,
  findArtworkPda,
  findCollectionAuthorityPda,
  findConfigPda,
  getKathaConfigEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS as REGISTRY,
  parseInitializePlatformInstruction,
  parseRegisterArtworkInstruction,
} from "../src/generated/registry/index.js";
import {
  buildInitializePlatformTransaction,
  buildRegisterArtworkTransaction,
  type ArtworkRegistrationInput,
  type PlatformInitializationInput,
  type RegistryTransactionContext,
} from "../src/registration.js";

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
const authority = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const collection = address("Vote111111111111111111111111111111111111111");
const feePayer = address("SysvarRent111111111111111111111111111111111");

function account(
  accountAddress: Address,
  owner: Address,
  data: Uint8Array,
  executable = false,
): EncodedAccount & { exists: true } {
  return {
    exists: true,
    address: accountAddress,
    programAddress: owner,
    data,
    space: BigInt(data.length),
    lamports: lamports(1_000_000n),
    executable,
  };
}

const context: RegistryTransactionContext = {
  cluster: "localnet",
  feePayerAddress: feePayer,
  authorityAddress: authority,
  supportedTransactionVersions: new Set([0, 1]),
  lifetime: { blockhash: blockhash(SYSTEM), lastValidBlockHeight: 100n },
  currentBlockHeight: 1n,
};
const artwork: ArtworkRegistrationInput = {
  kathaId: "KATHA-PAUBHA-000001",
  category: "PAUBHA",
  artistId: "123e4567-e89b-42d3-a456-426614174000",
  creatorWallet: null,
  creationYear: 2025,
  authorshipEvidenceHash: "07".repeat(32),
};

async function fixtures() {
  const [config, bump] = await findConfigPda();
  const [collectionAuthority, collectionAuthorityBump] =
    await findCollectionAuthorityPda();
  const [programData] = await getProgramDerivedAddress({
    programAddress: LOADER,
    seeds: [getAddressEncoder().encode(REGISTRY)],
  });
  const programBytes = new Uint8Array(36);
  new DataView(programBytes.buffer).setUint32(0, 2, true);
  programBytes.set(getAddressEncoder().encode(programData), 4);
  const dataBytes = new Uint8Array(45);
  new DataView(dataBytes.buffer).setUint32(0, 3, true);
  dataBytes[12] = 1;
  dataBytes.set(getAddressEncoder().encode(authority), 13);
  const platform: PlatformInitializationInput = {
    programAccount: account(REGISTRY, LOADER, programBytes, true),
    programDataAccount: account(programData, LOADER, dataBytes),
    collectionAccount: account(
      collection,
      CORE_PROGRAM_ADDRESS,
      getCollectionV1AccountDataSerializer().serialize({
        key: Key.CollectionV1,
        updateAuthority: publicKey(collectionAuthority),
        name: "Katha fixture",
        uri: "https://katha.fun/test/collection.json",
        numMinted: 0,
        currentSize: 0,
      }),
    ),
    registrationAuthority: authority,
    verifierAuthority: feePayer,
    custodyAuthority: authority,
    treasury: feePayer,
  };
  const configAccount = account(
    config,
    REGISTRY,
    Uint8Array.from(
      getKathaConfigEncoder().encode({
        authority,
        registrationAuthority: authority,
        verifierAuthority: feePayer,
        custodyAuthority: authority,
        treasury: feePayer,
        collection,
        collectionAuthority,
        bump,
        collectionAuthorityBump,
      }),
    ),
  );
  return { platform, configAccount, config, programData, collectionAuthority };
}

describe("Registry transaction builders", () => {
  let fixture: Awaited<ReturnType<typeof fixtures>>;
  beforeEach(async () => {
    fixture = await fixtures();
  });

  it("builds an unsigned bootstrap with canonical accounts and separate fee/rent payers", async () => {
    const result = await buildInitializePlatformTransaction(context, fixture.platform);
    expect(result.addresses).toEqual({
      config: fixture.config,
      programData: fixture.programData,
      collection,
      collectionAuthority: fixture.collectionAuthority,
    });
    expect(result.instruction.accounts.map(({ address }) => address)).toEqual([
      fixture.config,
      authority,
      REGISTRY,
      fixture.programData,
      collection,
      fixture.collectionAuthority,
      SYSTEM,
    ]);
    expect(result.instruction.accounts.map(({ role }) => role)).toEqual([
      AccountRole.WRITABLE,
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.READONLY,
    ]);
    expect(parseInitializePlatformInstruction(result.instruction).data.treasury).toBe(
      feePayer,
    );
    expect(result.transactionMessage.version).toBe(0);
    expect(result.transactionMessage.feePayer.address).toBe(feePayer);
    expect(result.transactionMessage.lifetimeConstraint).toEqual(context.lifetime);
    expect(result.requiredSignerAddresses).toEqual([feePayer, authority]);
    expect(result.instruction.accounts.every((meta) => !("signer" in meta))).toBe(true);
    expect(
      Object.values(compileTransaction(result.transactionMessage).signatures),
    ).toEqual([null, null]);
  });

  it("encodes immutable registration fields using the generated client", async () => {
    const result = await buildRegisterArtworkTransaction(
      context,
      fixture.configAccount,
      artwork,
    );
    const [expectedArtwork] = await findArtworkPda({ kathaId: artwork.kathaId });
    expect(result.addresses).toEqual({
      config: fixture.config,
      artwork: expectedArtwork,
      collection,
    });
    const parsed = parseRegisterArtworkInstruction(result.instruction);
    expect(parsed.data).toMatchObject({
      kathaId: artwork.kathaId,
      artistId: artwork.artistId,
      category: ArtworkCategory.Paubha,
      creationYear: 2025,
      creatorWallet: { __option: "None" },
    });
    expect(Array.from(parsed.data.authorshipEvidenceHash)).toEqual(Array(32).fill(7));
    expect(result.instruction.accounts.map(({ address }) => address)).toEqual([
      fixture.config,
      expectedArtwork,
      authority,
      SYSTEM,
    ]);
    expect(result.transactionMessage.instructions).toEqual([result.instruction]);
  });

  it("keeps the optional creator wallet separate and deduplicates signature addresses", async () => {
    const result = await buildRegisterArtworkTransaction(
      { ...context, feePayerAddress: authority },
      fixture.configAccount,
      { ...artwork, creatorWallet: collection },
    );
    expect(
      parseRegisterArtworkInstruction(result.instruction).data.creatorWallet,
    ).toEqual({
      __option: "Some",
      value: collection,
    });
    expect(result.requiredSignerAddresses).toEqual([authority]);
  });

  it.each([
    [new Set<0 | 1>([0, 1]), 1],
    [new Set<0 | 1>([0]), 0],
  ] as const)(
    "selects the supported Devnet version for %s",
    async (versions, version) => {
      const result = await buildRegisterArtworkTransaction(
        { ...context, cluster: "devnet", supportedTransactionVersions: versions },
        fixture.configAccount,
        artwork,
      );
      expect(result.transactionMessage.version).toBe(version);
      expect(result.cluster).toBe("devnet");
    },
  );

  it("rejects invalid cluster, signature addresses, and lifetime inputs", async () => {
    for (const invalid of [
      { ...context, cluster: "mainnet" } as unknown as RegistryTransactionContext,
      { ...context, supportedTransactionVersions: new Set<0 | 1>([1]) },
      { ...context, feePayerAddress: SYSTEM },
      { ...context, feePayerAddress: "invalid" as Address },
      { ...context, authorityAddress: SYSTEM },
      { ...context, currentBlockHeight: -1n },
      { ...context, currentBlockHeight: 101n },
      {
        ...context,
        lifetime: { ...context.lifetime, lastValidBlockHeight: 1n << 64n },
      },
      {
        ...context,
        lifetime: {
          ...context.lifetime,
          blockhash: "bad" as typeof context.lifetime.blockhash,
        },
      },
    ])
      await expect(
        buildRegisterArtworkTransaction(invalid, fixture.configAccount, artwork),
      ).rejects.toThrow();
  });

  it("rejects forged configuration ownership, discriminator, seeds, bump, and registration signer", async () => {
    const bytes = Uint8Array.from(fixture.configAccount.data);
    bytes.fill(0, 0, 8);
    const badBump = Uint8Array.from(fixture.configAccount.data);
    badBump[badBump.length - 2] = (badBump[badBump.length - 2]! + 1) % 256;
    for (const invalid of [
      { ...fixture.configAccount, programAddress: CORE_PROGRAM_ADDRESS },
      { ...fixture.configAccount, address: collection },
      { ...fixture.configAccount, executable: true },
      { ...fixture.configAccount, data: bytes },
      { ...fixture.configAccount, data: badBump },
      account(fixture.config, REGISTRY, bytes.subarray(0, 20)),
    ])
      await expect(
        buildRegisterArtworkTransaction(context, invalid, artwork),
      ).rejects.toThrow();
    await expect(
      buildRegisterArtworkTransaction(
        { ...context, authorityAddress: feePayer },
        fixture.configAccount,
        artwork,
      ),
    ).rejects.toThrow();
  });

  it("rejects forged bootstrap program and collection authority snapshots", async () => {
    const platform = fixture.platform;
    const badPointer = Uint8Array.from(platform.programAccount.data);
    badPointer.set(getAddressEncoder().encode(collection), 4);
    const immutable = Uint8Array.from(platform.programDataAccount.data);
    immutable[12] = 0;
    for (const invalid of [
      {
        ...platform,
        programAccount: { ...platform.programAccount, executable: false },
      },
      {
        ...platform,
        programAccount: { ...platform.programAccount, programAddress: REGISTRY },
      },
      { ...platform, programAccount: { ...platform.programAccount, data: badPointer } },
      {
        ...platform,
        programDataAccount: { ...platform.programDataAccount, address: collection },
      },
      {
        ...platform,
        programDataAccount: { ...platform.programDataAccount, data: immutable },
      },
      {
        ...platform,
        collectionAccount: { ...platform.collectionAccount, programAddress: REGISTRY },
      },
      { ...platform, treasury: SYSTEM },
    ])
      await expect(
        buildInitializePlatformTransaction(context, invalid),
      ).rejects.toThrow();
    await expect(
      buildInitializePlatformTransaction(
        { ...context, authorityAddress: feePayer },
        platform,
      ),
    ).rejects.toThrow();
  });

  it("rejects invalid permanent IDs, attribution, hash, year, and creator wallet", async () => {
    for (const invalid of [
      { ...artwork, kathaId: "KATHA-PAUBHA-000000" },
      { ...artwork, category: "THANGKA" as const },
      { ...artwork, artistId: artwork.artistId.toUpperCase() },
      { ...artwork, artistId: "not-a-uuid" },
      { ...artwork, creationYear: 0 },
      { ...artwork, creationYear: 2025.5 },
      { ...artwork, authorshipEvidenceHash: "00".repeat(32) },
      { ...artwork, authorshipEvidenceHash: "bad" },
      { ...artwork, creatorWallet: "bad" },
      { ...artwork, creatorWallet: SYSTEM },
    ])
      await expect(
        buildRegisterArtworkTransaction(context, fixture.configAccount, invalid),
      ).rejects.toThrow();
  });
});
