import { createHash } from "node:crypto";
import {
  AccountRole,
  addSignersToInstruction,
  address,
  createClient,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  lamports,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { litesvm } from "@solana/kit-plugin-litesvm";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { signer } from "@solana/kit-plugin-signer";
import { describe, expect, it } from "vitest";
import {
  buildCreateCoreCollectionInstruction,
  CORE_PROGRAM_ADDRESS,
} from "../src/core.js";

const REGISTRY = address("5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC");
const SYSTEM = address("11111111111111111111111111111111");
const UPGRADEABLE_LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const coreBinary = process.env.KATHA_TEST_CORE_SO;
const registryBinary = process.env.KATHA_TEST_REGISTRY_SO;
if (!coreBinary || !registryBinary) {
  throw new Error("Registry program binaries must be provided by pnpm program:test");
}

type Roles = {
  registration: Address;
  verifier: Address;
  custody: Address;
  treasury: Address;
};

async function addresses() {
  const [config, configBump] = await getProgramDerivedAddress({
    programAddress: REGISTRY,
    seeds: [new TextEncoder().encode("katha-config")],
  });
  const [collectionAuthority, collectionAuthorityBump] = await getProgramDerivedAddress(
    {
      programAddress: REGISTRY,
      seeds: [new TextEncoder().encode("collection-authority")],
    },
  );
  return { config, configBump, collectionAuthority, collectionAuthorityBump };
}

function initializeInstruction(
  bootstrap: Address,
  programData: Address,
  collection: Address,
  config: Address,
  collectionAuthority: Address,
  roles: Roles,
  program: Address = REGISTRY,
) {
  const discriminator = createHash("sha256")
    .update("global:initialize_platform")
    .digest()
    .subarray(0, 8);
  const encode = getAddressEncoder();
  const data = Uint8Array.from([
    ...discriminator,
    ...encode.encode(roles.registration),
    ...encode.encode(roles.verifier),
    ...encode.encode(roles.custody),
    ...encode.encode(roles.treasury),
  ]);
  return {
    programAddress: REGISTRY,
    accounts: [
      { address: config, role: AccountRole.WRITABLE },
      { address: bootstrap, role: AccountRole.WRITABLE_SIGNER },
      { address: program, role: AccountRole.READONLY },
      { address: programData, role: AccountRole.READONLY },
      { address: collection, role: AccountRole.READONLY },
      { address: collectionAuthority, role: AccountRole.READONLY },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data,
  };
}

function registerArtworkInstruction(
  config: Address,
  artwork: Address,
  authority: Address,
  kathaId: string,
  artistId = "123e4567-e89b-42d3-a456-426614174000",
  category = 1,
  creationYear = 2025,
  hash = new Uint8Array(32).fill(7),
  creatorWallet?: Address,
) {
  const discriminator = createHash("sha256")
    .update("global:register_artwork")
    .digest()
    .subarray(0, 8);
  const string = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length, true);
    return [...length, ...bytes];
  };
  const year = new Uint8Array(2);
  new DataView(year.buffer).setUint16(0, creationYear, true);
  return {
    programAddress: REGISTRY,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: artwork, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([
      ...discriminator,
      ...string(kathaId),
      ...string(artistId),
      creatorWallet ? 1 : 0,
      ...(creatorWallet ? getAddressEncoder().encode(creatorWallet) : []),
      category,
      ...year,
      ...hash,
    ]),
  };
}

function verifyArtworkInstruction(
  config: Address,
  artwork: Address,
  verification: Address,
  verifier: Address,
  evidenceHash: Uint8Array,
) {
  const discriminator = createHash("sha256")
    .update("global:verify_artwork")
    .digest()
    .subarray(0, 8);
  return {
    programAddress: REGISTRY,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: artwork, role: AccountRole.READONLY },
      { address: verification, role: AccountRole.WRITABLE },
      { address: verifier, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([...discriminator, ...evidenceHash]),
  };
}

function readBorshString(data: Uint8Array, offset: number) {
  const length = new DataView(data.buffer, data.byteOffset).getUint32(offset, true);
  return {
    value: new TextDecoder().decode(data.subarray(offset + 4, offset + 4 + length)),
    next: offset + 4 + length,
  };
}

function programDataAddress(programData: Uint8Array): Address {
  if (programData.length < 36 || programData[0] !== 2) {
    throw new Error("Registry fixture is not an upgradeable program");
  }
  return getAddressDecoder().decode(programData.subarray(4, 36));
}

function assertConfigData(
  data: Uint8Array,
  authority: Address,
  collection: Address,
  collectionAuthority: Address,
  roles: Roles,
  bumps: { configBump: number; collectionAuthorityBump: number },
) {
  const discriminator = createHash("sha256")
    .update("account:KathaConfig")
    .digest()
    .subarray(0, 8);
  expect(Array.from(data.subarray(0, 8))).toEqual(Array.from(discriminator));
  const decode = getAddressDecoder();
  const fields = Array.from({ length: 7 }, (_, index) =>
    decode.decode(data.subarray(8 + index * 32, 40 + index * 32)),
  );
  expect(fields).toEqual([
    authority,
    roles.registration,
    roles.verifier,
    roles.custody,
    roles.treasury,
    collection,
    collectionAuthority,
  ]);
  expect(data[232]).toBe(bumps.configBump);
  expect(data[233]).toBe(bumps.collectionAuthorityBump);
  expect(data.length).toBe(234);
}

describe("Registry platform and artwork identity in LiteSVM", () => {
  it("bootstraps, registers, and verifies with canonical authorities and accounts", async () => {
    const bootstrap = await generateKeyPairSigner();
    const wrongSigner = await generateKeyPairSigner();
    const collection = await generateKeyPairSigner();
    const wrongAuthorityCollection = await generateKeyPairSigner();
    const registration = await generateKeyPairSigner();
    const verifier = await generateKeyPairSigner();
    const custody = await generateKeyPairSigner();
    const treasury = await generateKeyPairSigner();
    const roles: Roles = {
      registration: registration.address,
      verifier: verifier.address,
      custody: custody.address,
      treasury: treasury.address,
    };
    const pdas = await addresses();
    const client = createClient()
      .use(signer(bootstrap))
      .use(litesvm({ transactionConfig: { version: 0 } }));
    client.svm.addProgramFromFile(CORE_PROGRAM_ADDRESS, coreBinary);
    client.svm.addProgramFromFile(REGISTRY, registryBinary);
    client.svm.airdrop(bootstrap.address, lamports(5_000_000_000n));

    const programAccount = client.svm.getAccount(REGISTRY);
    if (!programAccount.exists) throw new Error("Registry program is missing");
    expect(programAccount.programAddress).toBe(UPGRADEABLE_LOADER);
    const dataAddress = programDataAddress(programAccount.data);
    const programData = client.svm.getAccount(dataAddress);
    if (!programData.exists) throw new Error("Registry ProgramData is missing");
    expect(programData.programAddress).toBe(UPGRADEABLE_LOADER);
    // LiteSVM loads an upgradeable program with no authority; install a synthetic
    // authority and keep the executable bytes at the ProgramData offset.
    const upgradedData = new Uint8Array(programData.data.length + 32);
    upgradedData.set(programData.data.subarray(0, 12));
    upgradedData[12] = 1;
    upgradedData.set(getAddressEncoder().encode(bootstrap.address), 13);
    upgradedData.set(programData.data.subarray(13), 45);
    client.svm.setAccount({
      ...programData,
      data: upgradedData,
      space: BigInt(upgradedData.length),
      lamports: lamports(programData.lamports + 1_000_000n),
    });

    const createCollection = (collectionAddress: Address, updateAuthority: Address) =>
      addSignersToInstruction(
        [
          collectionAddress === collection.address
            ? collection
            : wrongAuthorityCollection,
        ],
        buildCreateCoreCollectionInstruction({
          collectionAddress,
          payerAddress: bootstrap.address,
          updateAuthorityAddress: updateAuthority,
          name: "Katha bootstrap fixture",
          uri: "https://katha.fun/test/collection.json",
        }),
      );
    await client.sendTransaction([
      createCollection(collection.address, pdas.collectionAuthority),
    ]);
    await client.sendTransaction([
      createCollection(wrongAuthorityCollection.address, wrongSigner.address),
    ]);

    const instruction = (
      bootstrapAddress: Address = bootstrap.address,
      programDataAddressValue: Address = dataAddress,
      collectionAddress: Address = collection.address,
      configAddress: Address = pdas.config,
      collectionAuthorityAddress: Address = pdas.collectionAuthority,
      roleValues: Roles = roles,
      programAddress: Address = REGISTRY,
    ) =>
      initializeInstruction(
        bootstrapAddress,
        programDataAddressValue,
        collectionAddress,
        configAddress,
        collectionAuthorityAddress,
        roleValues,
        programAddress,
      );
    const remainsAbsent = () =>
      expect(client.svm.getAccount(pdas.config).exists).toBe(false);

    await expect(
      client.sendTransaction([
        addSignersToInstruction([wrongSigner], instruction(wrongSigner.address)),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    const unrelatedData = await generateKeyPairSigner();
    client.svm.setAccount({ ...programData, address: unrelatedData.address });
    await expect(
      client.sendTransaction([instruction(bootstrap.address, unrelatedData.address)]),
    ).rejects.toThrow();
    remainsAbsent();

    await expect(
      client.sendTransaction([
        instruction(
          bootstrap.address,
          dataAddress,
          collection.address,
          pdas.config,
          pdas.collectionAuthority,
          roles,
          CORE_PROGRAM_ADDRESS,
        ),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    await expect(
      client.sendTransaction([
        instruction(bootstrap.address, dataAddress, wrongAuthorityCollection.address),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    const bogusCollection = await generateKeyPairSigner();
    client.svm.setAccount({
      address: bogusCollection.address,
      programAddress: CORE_PROGRAM_ADDRESS,
      data: new Uint8Array([1]),
      space: 1n,
      lamports: lamports(1_000_000n),
      executable: false,
    });
    await expect(
      client.sendTransaction([
        instruction(bootstrap.address, dataAddress, bogusCollection.address),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    await expect(
      client.sendTransaction([
        instruction(
          bootstrap.address,
          dataAddress,
          collection.address,
          pdas.config,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    await expect(
      client.sendTransaction([
        instruction(
          bootstrap.address,
          dataAddress,
          collection.address,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    await expect(
      client.sendTransaction([
        instruction(
          bootstrap.address,
          dataAddress,
          collection.address,
          pdas.config,
          pdas.collectionAuthority,
          { ...roles, verifier: SYSTEM },
        ),
      ]),
    ).rejects.toThrow();
    remainsAbsent();

    await client.sendTransaction([instruction()]);
    const config = client.svm.getAccount(pdas.config);
    if (!config.exists) throw new Error("KathaConfig was not created");
    expect(config.programAddress).toBe(REGISTRY);
    assertConfigData(
      config.data,
      bootstrap.address,
      collection.address,
      pdas.collectionAuthority,
      roles,
      pdas,
    );
    await expect(client.sendTransaction([instruction()])).rejects.toThrow();
    const unchanged = client.svm.getAccount(pdas.config);
    expect(unchanged.exists && Array.from(unchanged.data)).toEqual(
      Array.from(config.data),
    );

    client.svm.airdrop(registration.address, lamports(2_000_000_000n));
    client.svm.airdrop(wrongSigner.address, lamports(2_000_000_000n));
    const kathaId = "KATHA-PAUBHA-000001";
    const artistId = "123e4567-e89b-42d3-a456-426614174000";
    const [artwork, artworkBump] = await getProgramDerivedAddress({
      programAddress: REGISTRY,
      seeds: [new TextEncoder().encode("artwork"), new TextEncoder().encode(kathaId)],
    });
    const [wrongArtwork] = await getProgramDerivedAddress({
      programAddress: REGISTRY,
      seeds: [
        new TextEncoder().encode("artwork"),
        new TextEncoder().encode("KATHA-PAUBHA-999999"),
      ],
    });
    const [zeroSerialArtwork] = await getProgramDerivedAddress({
      programAddress: REGISTRY,
      seeds: [
        new TextEncoder().encode("artwork"),
        new TextEncoder().encode("KATHA-PAUBHA-000000"),
      ],
    });
    const register = (
      id = kathaId,
      artist = artistId,
      category = 1,
      year = 2025,
      hash = new Uint8Array(32).fill(7),
      account = artwork,
      authority = registration.address,
      configAddress = pdas.config,
      wallet?: Address,
    ) =>
      addSignersToInstruction(
        [authority === registration.address ? registration : wrongSigner],
        registerArtworkInstruction(
          configAddress,
          account,
          authority,
          id,
          artist,
          category,
          year,
          hash,
          wallet,
        ),
      );
    const absent = () => expect(client.svm.getAccount(artwork).exists).toBe(false);
    await expect(
      client.sendTransaction([
        register(kathaId, artistId, 1, 2025, undefined, artwork, wrongSigner.address),
      ]),
    ).rejects.toThrow();
    absent();
    await expect(
      client.sendTransaction([
        register(
          kathaId,
          artistId,
          1,
          2025,
          undefined,
          artwork,
          registration.address,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    absent();
    await expect(
      client.sendTransaction([
        register(kathaId, artistId, 1, 2025, undefined, wrongArtwork),
      ]),
    ).rejects.toThrow();
    absent();
    for (const invalid of [
      register("KATHA-PAUBHA-000000", artistId, 1, 2025, undefined, zeroSerialArtwork),
      register(kathaId, artistId, 0),
      register(kathaId, "invalid-artist-id"),
      register(kathaId, artistId, 1, 0),
      register(kathaId, artistId, 1, 2025, new Uint8Array(32)),
      register(
        kathaId,
        artistId,
        1,
        2025,
        undefined,
        artwork,
        registration.address,
        pdas.config,
        SYSTEM,
      ),
    ]) {
      await expect(client.sendTransaction([invalid])).rejects.toThrow();
      absent();
    }
    await client.sendTransaction([register()]);
    const record = client.svm.getAccount(artwork);
    if (!record.exists) throw new Error("ArtworkRecord was not created");
    expect(record.programAddress).toBe(REGISTRY);
    expect(record.data.length).toBe(246);
    expect(Array.from(record.data.subarray(0, 8))).toEqual(
      Array.from(
        createHash("sha256").update("account:ArtworkRecord").digest().subarray(0, 8),
      ),
    );
    const id = readBorshString(record.data, 8);
    const artist = readBorshString(record.data, id.next);
    expect(id.value).toBe(kathaId);
    expect(artist.value).toBe(artistId);
    expect(record.data[artist.next]).toBe(0); // Creator wallet is optional.
    expect(record.data[artist.next + 1]).toBe(1); // Paubha category.
    expect(
      new DataView(record.data.buffer, record.data.byteOffset).getUint16(
        artist.next + 2,
        true,
      ),
    ).toBe(2025);
    expect(Array.from(record.data.subarray(artist.next + 4, artist.next + 36))).toEqual(
      Array(32).fill(7),
    );
    expect(
      getAddressDecoder().decode(
        record.data.subarray(artist.next + 36, artist.next + 68),
      ),
    ).toBe(collection.address);
    expect(record.data[artist.next + 68]).toBe(0); // Core asset is unbound until minting.
    expect(
      getAddressDecoder().decode(
        record.data.subarray(artist.next + 69, artist.next + 101),
      ),
    ).toBe(registration.address);
    expect(record.data[artist.next + 109]).toBe(artworkBump);
    await expect(
      client.sendTransaction([
        register(kathaId, "123e4567-e89b-42d3-a456-426614174001", 1, 2024),
      ]),
    ).rejects.toThrow();
    const afterDuplicate = client.svm.getAccount(artwork);
    expect(afterDuplicate.exists && Array.from(afterDuplicate.data)).toEqual(
      Array.from(record.data),
    );

    client.svm.airdrop(verifier.address, lamports(2_000_000_000n));
    const [verification, verificationBump] = await getProgramDerivedAddress({
      programAddress: REGISTRY,
      seeds: [
        new TextEncoder().encode("verification"),
        getAddressEncoder().encode(artwork),
      ],
    });
    const verify = (
      art = artwork,
      attestation = verification,
      authority = verifier.address,
      evidenceHash = new Uint8Array(32).fill(7),
      configAddress = pdas.config,
    ) =>
      addSignersToInstruction(
        [authority === verifier.address ? verifier : wrongSigner],
        verifyArtworkInstruction(
          configAddress,
          art,
          attestation,
          authority,
          evidenceHash,
        ),
      );
    const unverified = () =>
      expect(client.svm.getAccount(verification).exists).toBe(false);
    await expect(
      client.sendTransaction([verify(artwork, verification, wrongSigner.address)]),
    ).rejects.toThrow();
    unverified();
    await expect(
      client.sendTransaction([
        verify(artwork, verification, verifier.address, undefined, wrongSigner.address),
      ]),
    ).rejects.toThrow();
    unverified();
    await expect(
      client.sendTransaction([
        verify(artwork, verification, verifier.address, new Uint8Array(32).fill(8)),
      ]),
    ).rejects.toThrow();
    unverified();
    await expect(client.sendTransaction([verify(wrongArtwork)])).rejects.toThrow();
    unverified();
    const [otherArtwork] = await getProgramDerivedAddress({
      programAddress: REGISTRY,
      seeds: [
        new TextEncoder().encode("artwork"),
        new TextEncoder().encode("KATHA-PAUBHA-000002"),
      ],
    });
    await client.sendTransaction([
      register("KATHA-PAUBHA-000002", artistId, 1, 2025, undefined, otherArtwork),
    ]);
    await expect(client.sendTransaction([verify(otherArtwork)])).rejects.toThrow();
    unverified();
    const wrongCollectionData = Uint8Array.from(record.data);
    wrongCollectionData.set(
      getAddressEncoder().encode(wrongSigner.address),
      artist.next + 36,
    );
    client.svm.setAccount({ ...record, data: wrongCollectionData });
    await expect(client.sendTransaction([verify()])).rejects.toThrow();
    unverified();
    const wrongIdentityData = Uint8Array.from(record.data);
    wrongIdentityData[id.next - 1] = "2".charCodeAt(0);
    client.svm.expireBlockhash();
    client.svm.setAccount({ ...record, data: wrongIdentityData });
    await expect(client.sendTransaction([verify()])).rejects.toThrow();
    unverified();
    client.svm.setAccount(record);
    client.svm.expireBlockhash();

    await client.sendTransaction([verify()]);
    const attestation = client.svm.getAccount(verification);
    if (!attestation.exists) throw new Error("ArtworkVerification was not created");
    expect(attestation.programAddress).toBe(REGISTRY);
    expect(attestation.data.length).toBe(113);
    expect(Array.from(attestation.data.subarray(0, 8))).toEqual(
      Array.from(
        createHash("sha256")
          .update("account:ArtworkVerification")
          .digest()
          .subarray(0, 8),
      ),
    );
    expect(getAddressDecoder().decode(attestation.data.subarray(8, 40))).toBe(artwork);
    expect(Array.from(attestation.data.subarray(40, 72))).toEqual(Array(32).fill(7));
    expect(getAddressDecoder().decode(attestation.data.subarray(72, 104))).toBe(
      verifier.address,
    );
    expect(attestation.data[112]).toBe(verificationBump);
    const afterVerification = client.svm.getAccount(artwork);
    expect(afterVerification.exists && Array.from(afterVerification.data)).toEqual(
      Array.from(record.data),
    );
    client.svm.expireBlockhash();
    await expect(client.sendTransaction([verify()])).rejects.toThrow();
    const afterReplay = client.svm.getAccount(verification);
    expect(afterReplay.exists && Array.from(afterReplay.data)).toEqual(
      Array.from(attestation.data),
    );
  });
});

describe("Registry platform initialization in Surfpool", () => {
  it("accepts the upgrade authority and rejects another signer and duplicate initialization", async () => {
    const rpcUrl = process.env.KATHA_TEST_SURFPOOL_RPC;
    const wsUrl = process.env.KATHA_TEST_SURFPOOL_WS;
    if (!rpcUrl || !wsUrl) throw new Error("Surfpool endpoints are required");
    const url = rpcUrl;
    async function cheat(method: string, params: unknown[]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const result = await response.json();
      if (result.error) throw new Error(JSON.stringify(result.error));
    }
    const bootstrap = await generateKeyPairSigner();
    const wrongSigner = await generateKeyPairSigner();
    const collection = await generateKeyPairSigner();
    const registration = await generateKeyPairSigner();
    const verifier = await generateKeyPairSigner();
    const custody = await generateKeyPairSigner();
    const treasury = await generateKeyPairSigner();
    const roles: Roles = {
      registration: registration.address,
      verifier: verifier.address,
      custody: custody.address,
      treasury: treasury.address,
    };
    const pdas = await addresses();
    await cheat("surfnet_setAccount", [bootstrap.address, { lamports: 5_000_000_000 }]);
    await cheat("surfnet_setProgramAuthority", [REGISTRY, bootstrap.address]);
    const client = createClient()
      .use(signer(bootstrap))
      .use(
        solanaRpc({
          rpcUrl,
          rpcSubscriptionsUrl: wsUrl,
          transactionConfig: { version: 0 },
        }),
      );
    const program = await fetchEncodedAccount(client.rpc, REGISTRY);
    if (!program.exists) throw new Error("Registry program is missing");
    expect(program.programAddress).toBe(UPGRADEABLE_LOADER);
    const dataAddress = programDataAddress(program.data);
    const programData = await fetchEncodedAccount(client.rpc, dataAddress);
    expect(programData.exists).toBe(true);
    await client.sendTransaction([
      addSignersToInstruction(
        [collection],
        buildCreateCoreCollectionInstruction({
          collectionAddress: collection.address,
          payerAddress: bootstrap.address,
          updateAuthorityAddress: pdas.collectionAuthority,
          name: "Katha Surfpool fixture",
          uri: "https://katha.fun/test/collection.json",
        }),
      ),
    ]);
    const init = (bootstrapAddress: Address) =>
      initializeInstruction(
        bootstrapAddress,
        dataAddress,
        collection.address,
        pdas.config,
        pdas.collectionAuthority,
        roles,
      );
    await expect(
      client.sendTransaction([
        addSignersToInstruction([wrongSigner], init(wrongSigner.address)),
      ]),
    ).rejects.toThrow();
    expect((await fetchEncodedAccount(client.rpc, pdas.config)).exists).toBe(false);

    await client.sendTransaction([init(bootstrap.address)]);
    const config = await fetchEncodedAccount(client.rpc, pdas.config);
    if (!config.exists) throw new Error("KathaConfig was not created");
    expect(config.programAddress).toBe(REGISTRY);
    assertConfigData(
      config.data,
      bootstrap.address,
      collection.address,
      pdas.collectionAuthority,
      roles,
      pdas,
    );
    await expect(client.sendTransaction([init(bootstrap.address)])).rejects.toThrow();
  });
});
