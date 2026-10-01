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

function metadataInstruction(
  action: "initialize_metadata" | "revise_unminted_metadata",
  config: Address,
  artwork: Address,
  head: Address,
  revision: Address,
  authority: Address,
  hash: Uint8Array,
  uri: string,
  expectedVersion = 0,
  nextVersion = 0,
) {
  const discriminator = createHash("sha256")
    .update(`global:${action}`)
    .digest()
    .subarray(0, 8);
  const uriBytes = new TextEncoder().encode(uri);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, uriBytes.length, true);
  const versions = new Uint8Array(8);
  const view = new DataView(versions.buffer);
  view.setUint32(0, expectedVersion, true);
  view.setUint32(4, nextVersion, true);
  return {
    programAddress: REGISTRY,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: artwork, role: AccountRole.READONLY },
      { address: head, role: AccountRole.WRITABLE },
      { address: revision, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([
      ...discriminator,
      ...(action === "revise_unminted_metadata" ? versions : []),
      ...hash,
      ...length,
      ...uriBytes,
    ]),
  };
}

function conditionInstruction(
  action: "initialize_condition" | "record_unminted_condition",
  config: Address,
  artwork: Address,
  verification: Address,
  head: Address,
  report: Address,
  authority: Address,
  reportId: Uint8Array,
  reportHash: Uint8Array,
  grade: number,
  reason: number,
  inspectorId: Uint8Array,
  inspectedAt: number,
  expectedVersion = 0,
  nextVersion = 0,
) {
  const discriminator = createHash("sha256")
    .update(`global:${action}`)
    .digest()
    .subarray(0, 8);
  const versions = new Uint8Array(8);
  new DataView(versions.buffer).setUint32(0, expectedVersion, true);
  new DataView(versions.buffer).setUint32(4, nextVersion, true);
  const inspectedAtBytes = new Uint8Array(8);
  new DataView(inspectedAtBytes.buffer).setBigInt64(0, BigInt(inspectedAt), true);
  return {
    programAddress: REGISTRY,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: artwork, role: AccountRole.READONLY },
      { address: verification, role: AccountRole.READONLY },
      { address: head, role: AccountRole.WRITABLE },
      { address: report, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([
      ...discriminator,
      ...(action === "record_unminted_condition" ? versions : []),
      ...reportId,
      ...reportHash,
      grade,
      reason,
      ...inspectorId,
      ...inspectedAtBytes,
    ]),
  };
}

function custodyInstruction(
  action: "initialize_custody" | "transition_custody",
  config: Address,
  artwork: Address,
  head: Address,
  transition: Address,
  authority: Address,
  custodyAction: number,
  collector?: Address,
  expectedRevision = 0n,
  nextRevision = 0n,
) {
  const discriminator = createHash("sha256")
    .update(`global:${action}`)
    .digest()
    .subarray(0, 8);
  const revisions = new Uint8Array(16);
  new DataView(revisions.buffer).setBigUint64(0, expectedRevision, true);
  new DataView(revisions.buffer).setBigUint64(8, nextRevision, true);
  return {
    programAddress: REGISTRY,
    accounts: [
      { address: config, role: AccountRole.READONLY },
      { address: artwork, role: AccountRole.READONLY },
      { address: head, role: AccountRole.WRITABLE },
      { address: transition, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([
      ...discriminator,
      ...(action === "transition_custody" ? revisions : []),
      custodyAction,
      collector === undefined ? 0 : 1,
      ...(collector === undefined ? [] : getAddressEncoder().encode(collector)),
    ]),
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

    const metadataPda = async (seed: string, version?: number) => {
      const versionSeed = new Uint8Array(4);
      if (version !== undefined) {
        new DataView(versionSeed.buffer).setUint32(0, version, true);
      }
      return getProgramDerivedAddress({
        programAddress: REGISTRY,
        seeds: [
          new TextEncoder().encode(seed),
          getAddressEncoder().encode(artwork),
          ...(version === undefined ? [] : [versionSeed]),
        ],
      });
    };
    const [head] = await metadataPda("metadata");
    const [revision1] = await metadataPda("metadata-version", 1);
    const [revision2] = await metadataPda("metadata-version", 2);
    const [revision3] = await metadataPda("metadata-version", 3);
    const uri1 = "https://katha.fun/metadata/000001.json";
    const uri2 = "https://katha.fun/metadata/000001-v2.json";
    const hash1 = new Uint8Array(32).fill(11);
    const hash2 = new Uint8Array(32).fill(12);
    const metadata = (
      action: "initialize_metadata" | "revise_unminted_metadata",
      targetRevision: Address,
      hash: Uint8Array,
      uri: string,
      expectedVersion = 0,
      nextVersion = 0,
      art = artwork,
      metadataHead = head,
      authority = registration.address,
      configAddress = pdas.config,
    ) =>
      addSignersToInstruction(
        [authority === registration.address ? registration : wrongSigner],
        metadataInstruction(
          action,
          configAddress,
          art,
          metadataHead,
          targetRevision,
          authority,
          hash,
          uri,
          expectedVersion,
          nextVersion,
        ),
      );
    const initial = (
      hash = hash1,
      uri = uri1,
      art = artwork,
      metadataHead = head,
      targetRevision = revision1,
      authority = registration.address,
      configAddress = pdas.config,
    ) =>
      metadata(
        "initialize_metadata",
        targetRevision,
        hash,
        uri,
        0,
        0,
        art,
        metadataHead,
        authority,
        configAddress,
      );
    const revise = (
      expectedVersion = 1,
      nextVersion = 2,
      hash = hash2,
      uri = uri2,
      targetRevision = revision2,
      art = artwork,
      metadataHead = head,
      authority = registration.address,
      configAddress = pdas.config,
    ) =>
      metadata(
        "revise_unminted_metadata",
        targetRevision,
        hash,
        uri,
        expectedVersion,
        nextVersion,
        art,
        metadataHead,
        authority,
        configAddress,
      );
    const noMetadata = () => {
      expect(client.svm.getAccount(head).exists).toBe(false);
      expect(client.svm.getAccount(revision1).exists).toBe(false);
    };
    await expect(
      client.sendTransaction([
        initial(hash1, uri1, artwork, head, revision1, wrongSigner.address),
      ]),
    ).rejects.toThrow();
    noMetadata();
    await expect(
      client.sendTransaction([
        initial(
          hash1,
          uri1,
          artwork,
          head,
          revision1,
          registration.address,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    noMetadata();
    await expect(
      client.sendTransaction([initial(hash1, uri1, otherArtwork)]),
    ).rejects.toThrow();
    noMetadata();
    for (const invalid of [
      initial(new Uint8Array(32)),
      initial(hash1, "http://"),
      initial(hash1, `https://katha.fun/${"x".repeat(190)}`),
      initial(hash1, "https://user:password@katha.fun/art.json"),
    ]) {
      await expect(client.sendTransaction([invalid])).rejects.toThrow();
      noMetadata();
    }
    await client.sendTransaction([initial()]);
    const firstHead = client.svm.getAccount(head);
    const firstRevision = client.svm.getAccount(revision1);
    if (!firstHead.exists || !firstRevision.exists) {
      throw new Error("Initial metadata commitment was not created");
    }
    expect(firstHead.programAddress).toBe(REGISTRY);
    expect(firstHead.data.length).toBe(109);
    expect(getAddressDecoder().decode(firstHead.data.subarray(8, 40))).toBe(artwork);
    expect(
      new DataView(firstHead.data.buffer, firstHead.data.byteOffset).getUint32(
        40,
        true,
      ),
    ).toBe(1);
    expect(getAddressDecoder().decode(firstHead.data.subarray(44, 76))).toBe(revision1);
    expect(Array.from(firstHead.data.subarray(76, 108))).toEqual(Array(32).fill(11));
    expect(firstRevision.data.length).toBe(321);
    expect(getAddressDecoder().decode(firstRevision.data.subarray(8, 40))).toBe(
      artwork,
    );
    expect(
      new DataView(firstRevision.data.buffer, firstRevision.data.byteOffset).getUint32(
        40,
        true,
      ),
    ).toBe(1);
    expect(Array.from(firstRevision.data.subarray(44, 76))).toEqual(Array(32).fill(11));
    expect(readBorshString(firstRevision.data, 76).value).toBe(uri1);
    await expect(client.sendTransaction([initial()])).rejects.toThrow();

    const headUnchanged = () => {
      const current = client.svm.getAccount(head);
      expect(current.exists && Array.from(current.data)).toEqual(
        Array.from(firstHead.data),
      );
      expect(client.svm.getAccount(revision2).exists).toBe(false);
    };
    await expect(
      client.sendTransaction([
        revise(1, 2, hash2, uri2, revision2, artwork, head, wrongSigner.address),
      ]),
    ).rejects.toThrow();
    headUnchanged();
    await expect(
      client.sendTransaction([
        revise(
          1,
          2,
          hash2,
          uri2,
          revision2,
          artwork,
          head,
          registration.address,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    headUnchanged();
    await expect(client.sendTransaction([revise(0)])).rejects.toThrow();
    headUnchanged();
    await expect(
      client.sendTransaction([revise(1, 3, hash2, uri2, revision3)]),
    ).rejects.toThrow();
    headUnchanged();
    await expect(
      client.sendTransaction([revise(1, 2, new Uint8Array(32))]),
    ).rejects.toThrow();
    headUnchanged();
    await expect(
      client.sendTransaction([revise(1, 2, hash2, "http://")]),
    ).rejects.toThrow();
    headUnchanged();
    await expect(
      client.sendTransaction([revise(1, 2, hash2, uri2, revision3)]),
    ).rejects.toThrow();
    headUnchanged();
    await expect(
      client.sendTransaction([
        revise(1, 2, hash2, uri2, revision2, artwork, wrongArtwork),
      ]),
    ).rejects.toThrow();
    headUnchanged();
    const unrelatedHeadData = Uint8Array.from(firstHead.data);
    unrelatedHeadData.set(getAddressEncoder().encode(otherArtwork), 8);
    client.svm.setAccount({ ...firstHead, data: unrelatedHeadData });
    await expect(client.sendTransaction([revise()])).rejects.toThrow();
    client.svm.setAccount(firstHead);
    headUnchanged();
    const assetOption = artist.next + 68;
    const mintedData = new Uint8Array(record.data.length);
    mintedData.set(record.data.subarray(0, assetOption));
    mintedData[assetOption] = 1;
    mintedData.set(getAddressEncoder().encode(wrongSigner.address), assetOption + 1);
    mintedData.set(
      record.data.subarray(assetOption + 1, artist.next + 110),
      assetOption + 33,
    );
    client.svm.expireBlockhash();
    client.svm.setAccount({ ...record, data: mintedData });
    await expect(client.sendTransaction([revise()])).rejects.toThrow();
    client.svm.setAccount(record);
    headUnchanged();
    client.svm.expireBlockhash();
    await client.sendTransaction([revise()]);
    const secondHead = client.svm.getAccount(head);
    const secondRevision = client.svm.getAccount(revision2);
    if (!secondHead.exists || !secondRevision.exists) {
      throw new Error("Second metadata commitment was not created");
    }
    expect(
      new DataView(secondHead.data.buffer, secondHead.data.byteOffset).getUint32(
        40,
        true,
      ),
    ).toBe(2);
    expect(getAddressDecoder().decode(secondHead.data.subarray(44, 76))).toBe(
      revision2,
    );
    expect(Array.from(secondHead.data.subarray(76, 108))).toEqual(Array(32).fill(12));
    expect(readBorshString(secondRevision.data, 76).value).toBe(uri2);
    const preserved = client.svm.getAccount(revision1);
    expect(preserved.exists && Array.from(preserved.data)).toEqual(
      Array.from(firstRevision.data),
    );
    const identity = client.svm.getAccount(artwork);
    expect(identity.exists && Array.from(identity.data)).toEqual(
      Array.from(record.data),
    );
    const relocatedUri = "https://katha.fun/metadata/000001-relocated.json";
    await client.sendTransaction([revise(2, 3, hash2, relocatedUri, revision3)]);
    const thirdHead = client.svm.getAccount(head);
    const thirdRevision = client.svm.getAccount(revision3);
    if (!thirdHead.exists || !thirdRevision.exists) {
      throw new Error("Relocated metadata commitment was not created");
    }
    expect(
      new DataView(thirdHead.data.buffer, thirdHead.data.byteOffset).getUint32(
        40,
        true,
      ),
    ).toBe(3);
    expect(getAddressDecoder().decode(thirdHead.data.subarray(44, 76))).toBe(revision3);
    expect(Array.from(thirdHead.data.subarray(76, 108))).toEqual(Array(32).fill(12));
    expect(readBorshString(thirdRevision.data, 76).value).toBe(relocatedUri);
    const preservedSecond = client.svm.getAccount(revision2);
    expect(preservedSecond.exists && Array.from(preservedSecond.data)).toEqual(
      Array.from(secondRevision.data),
    );
    client.svm.expireBlockhash();
    await expect(client.sendTransaction([revise()])).rejects.toThrow();
    const afterStale = client.svm.getAccount(head);
    expect(afterStale.exists && Array.from(afterStale.data)).toEqual(
      Array.from(thirdHead.data),
    );

    const uuidBytes = (lastByte: number) =>
      Uint8Array.from([
        0x12,
        0x3e,
        0x45,
        0x67,
        0xe8,
        0x9b,
        0x42,
        0xd3,
        0xa4,
        0x56,
        0x42,
        0x66,
        0x14,
        0x17,
        0x40,
        lastByte,
      ]);
    const conditionId1 = uuidBytes(1);
    const conditionId2 = uuidBytes(2);
    const inspectorId = uuidBytes(9);
    const clock = client.svm.getClock();
    clock.unixTimestamp = 2_000_000_000n;
    client.svm.setClock(clock);
    const inspectionTime = Number(client.svm.getClock().unixTimestamp) - 60;
    expect(inspectionTime).toBeGreaterThan(0);
    const [conditionHead] = await getProgramDerivedAddress({
      programAddress: REGISTRY,
      seeds: [
        new TextEncoder().encode("condition"),
        getAddressEncoder().encode(artwork),
      ],
    });
    const reportPda = (reportId: Uint8Array) =>
      getProgramDerivedAddress({
        programAddress: REGISTRY,
        seeds: [new TextEncoder().encode("condition-report"), reportId],
      });
    const [conditionReport1] = await reportPda(conditionId1);
    const [conditionReport2] = await reportPda(conditionId2);
    const reportHash1 = new Uint8Array(32).fill(21);
    const reportHash2 = new Uint8Array(32).fill(22);
    const condition = (
      action: "initialize_condition" | "record_unminted_condition",
      reportId: Uint8Array,
      hash: Uint8Array,
      grade: number,
      reason: number,
      report: Address,
      expectedVersion = 0,
      nextVersion = 0,
      art = artwork,
      conditionVerification = verification,
      conditionHeadAddress = conditionHead,
      authority = verifier.address,
      inspectedAt = inspectionTime,
      inspector = inspectorId,
      configAddress = pdas.config,
    ) =>
      addSignersToInstruction(
        [authority === verifier.address ? verifier : wrongSigner],
        conditionInstruction(
          action,
          configAddress,
          art,
          conditionVerification,
          conditionHeadAddress,
          report,
          authority,
          reportId,
          hash,
          grade,
          reason,
          inspector,
          inspectedAt,
          expectedVersion,
          nextVersion,
        ),
      );
    const initialCondition = (
      reportId = conditionId1,
      hash = reportHash1,
      grade = 1,
      reason = 0,
      report = conditionReport1,
      art = artwork,
      conditionVerification = verification,
      conditionHeadAddress = conditionHead,
      authority = verifier.address,
      inspectedAt = inspectionTime,
      inspector = inspectorId,
      configAddress = pdas.config,
    ) =>
      condition(
        "initialize_condition",
        reportId,
        hash,
        grade,
        reason,
        report,
        0,
        0,
        art,
        conditionVerification,
        conditionHeadAddress,
        authority,
        inspectedAt,
        inspector,
        configAddress,
      );
    const followupCondition = (
      expectedVersion = 1,
      nextVersion = 2,
      reportId = conditionId2,
      hash = reportHash2,
      grade = 2,
      reason = 1,
      report = conditionReport2,
      art = artwork,
      conditionVerification = verification,
      conditionHeadAddress = conditionHead,
      authority = verifier.address,
      inspectedAt = inspectionTime,
      inspector = inspectorId,
      configAddress = pdas.config,
    ) =>
      condition(
        "record_unminted_condition",
        reportId,
        hash,
        grade,
        reason,
        report,
        expectedVersion,
        nextVersion,
        art,
        conditionVerification,
        conditionHeadAddress,
        authority,
        inspectedAt,
        inspector,
        configAddress,
      );
    const conditionAbsent = () => {
      expect(client.svm.getAccount(conditionHead).exists).toBe(false);
      expect(client.svm.getAccount(conditionReport1).exists).toBe(false);
    };
    await expect(
      client.sendTransaction([
        initialCondition(
          conditionId1,
          reportHash1,
          1,
          0,
          conditionReport1,
          artwork,
          verification,
          conditionHead,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    conditionAbsent();
    await expect(
      client.sendTransaction([
        initialCondition(
          conditionId1,
          reportHash1,
          1,
          0,
          conditionReport1,
          artwork,
          verification,
          conditionHead,
          verifier.address,
          inspectionTime,
          inspectorId,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    conditionAbsent();
    await expect(
      client.sendTransaction([
        initialCondition(
          conditionId1,
          reportHash1,
          1,
          0,
          conditionReport1,
          otherArtwork,
        ),
      ]),
    ).rejects.toThrow();
    conditionAbsent();
    await expect(
      client.sendTransaction([
        initialCondition(
          conditionId1,
          reportHash1,
          1,
          0,
          conditionReport1,
          artwork,
          wrongArtwork,
        ),
      ]),
    ).rejects.toThrow();
    conditionAbsent();
    const invalidReportId = new Uint8Array(conditionId1);
    invalidReportId[8] = 0;
    const invalidInspectorId = new Uint8Array(inspectorId);
    invalidInspectorId[6] = 0;
    for (const invalid of [
      initialCondition(invalidReportId),
      initialCondition(conditionId1, reportHash1, 1, 3),
      initialCondition(conditionId1, new Uint8Array(32)),
      initialCondition(
        conditionId1,
        reportHash1,
        1,
        0,
        conditionReport1,
        artwork,
        verification,
        conditionHead,
        verifier.address,
        0,
      ),
      initialCondition(
        conditionId1,
        reportHash1,
        1,
        0,
        conditionReport1,
        artwork,
        verification,
        conditionHead,
        verifier.address,
        Number(client.svm.getClock().unixTimestamp) + 60,
      ),
      initialCondition(
        conditionId1,
        reportHash1,
        1,
        0,
        conditionReport1,
        artwork,
        verification,
        conditionHead,
        verifier.address,
        inspectionTime,
        invalidInspectorId,
      ),
    ]) {
      await expect(client.sendTransaction([invalid])).rejects.toThrow();
      conditionAbsent();
    }
    await client.sendTransaction([initialCondition()]);
    const firstConditionHead = client.svm.getAccount(conditionHead);
    const firstConditionReport = client.svm.getAccount(conditionReport1);
    if (!firstConditionHead.exists || !firstConditionReport.exists) {
      throw new Error("Initial condition attestation was not created");
    }
    expect(firstConditionHead.programAddress).toBe(REGISTRY);
    expect(firstConditionHead.data.length).toBe(109);
    expect(getAddressDecoder().decode(firstConditionHead.data.subarray(8, 40))).toBe(
      artwork,
    );
    expect(
      new DataView(
        firstConditionHead.data.buffer,
        firstConditionHead.data.byteOffset,
      ).getUint32(40, true),
    ).toBe(1);
    expect(getAddressDecoder().decode(firstConditionHead.data.subarray(44, 76))).toBe(
      conditionReport1,
    );
    expect(Array.from(firstConditionHead.data.subarray(76, 108))).toEqual(
      Array(32).fill(21),
    );
    expect(firstConditionReport.data.length).toBe(201);
    expect(getAddressDecoder().decode(firstConditionReport.data.subarray(8, 40))).toBe(
      artwork,
    );
    expect(
      new DataView(
        firstConditionReport.data.buffer,
        firstConditionReport.data.byteOffset,
      ).getUint32(40, true),
    ).toBe(1);
    expect(Array.from(firstConditionReport.data.subarray(44, 60))).toEqual(
      Array.from(conditionId1),
    );
    expect(Array.from(firstConditionReport.data.subarray(60, 92))).toEqual(
      Array(32).fill(21),
    );
    expect(firstConditionReport.data[92]).toBe(1);
    expect(firstConditionReport.data[93]).toBe(0);
    expect(Array.from(firstConditionReport.data.subarray(94, 110))).toEqual(
      Array.from(inspectorId),
    );
    expect(
      getAddressDecoder().decode(firstConditionReport.data.subarray(110, 142)),
    ).toBe(verifier.address);
    expect(firstConditionReport.data[158]).toBe(0); // No owner scope before mint.
    expect(firstConditionReport.data[159]).toBe(0); // No custody scope before attestation.
    client.svm.expireBlockhash();
    await expect(client.sendTransaction([initialCondition()])).rejects.toThrow();
    const unchangedConditionHead = () => {
      const current = client.svm.getAccount(conditionHead);
      expect(current.exists && Array.from(current.data)).toEqual(
        Array.from(firstConditionHead.data),
      );
      expect(client.svm.getAccount(conditionReport2).exists).toBe(false);
    };
    await expect(
      client.sendTransaction([
        followupCondition(
          1,
          2,
          conditionId2,
          reportHash2,
          2,
          1,
          conditionReport2,
          artwork,
          verification,
          conditionHead,
          wrongSigner.address,
        ),
      ]),
    ).rejects.toThrow();
    unchangedConditionHead();
    await expect(
      client.sendTransaction([
        followupCondition(1, 2, conditionId2, reportHash2, 2, 3),
      ]),
    ).rejects.toThrow();
    unchangedConditionHead();
    await expect(client.sendTransaction([followupCondition(0)])).rejects.toThrow();
    unchangedConditionHead();
    await expect(client.sendTransaction([followupCondition(1, 3)])).rejects.toThrow();
    unchangedConditionHead();
    await expect(
      client.sendTransaction([
        followupCondition(1, 2, conditionId1, reportHash2, 2, 1, conditionReport1),
      ]),
    ).rejects.toThrow();
    unchangedConditionHead();
    await client.sendTransaction([followupCondition()]);
    const secondConditionHead = client.svm.getAccount(conditionHead);
    const secondConditionReport = client.svm.getAccount(conditionReport2);
    if (!secondConditionHead.exists || !secondConditionReport.exists) {
      throw new Error("Follow-up condition attestation was not created");
    }
    expect(
      new DataView(
        secondConditionHead.data.buffer,
        secondConditionHead.data.byteOffset,
      ).getUint32(40, true),
    ).toBe(2);
    expect(getAddressDecoder().decode(secondConditionHead.data.subarray(44, 76))).toBe(
      conditionReport2,
    );
    expect(Array.from(secondConditionHead.data.subarray(76, 108))).toEqual(
      Array(32).fill(22),
    );
    expect(secondConditionReport.data[92]).toBe(2);
    expect(secondConditionReport.data[93]).toBe(1);
    const preservedCondition = client.svm.getAccount(conditionReport1);
    expect(preservedCondition.exists && Array.from(preservedCondition.data)).toEqual(
      Array.from(firstConditionReport.data),
    );
    const afterCondition = client.svm.getAccount(artwork);
    expect(afterCondition.exists && Array.from(afterCondition.data)).toEqual(
      Array.from(record.data),
    );
    const conditionId3 = uuidBytes(3);
    const [conditionReport3] = await reportPda(conditionId3);
    client.svm.setAccount({ ...record, data: mintedData });
    await expect(
      client.sendTransaction([
        followupCondition(
          2,
          3,
          conditionId3,
          new Uint8Array(32).fill(23),
          1,
          3,
          conditionReport3,
        ),
      ]),
    ).rejects.toThrow();
    client.svm.setAccount(record);
    expect(client.svm.getAccount(conditionReport3).exists).toBe(false);
    const afterMintedAttempt = client.svm.getAccount(conditionHead);
    expect(afterMintedAttempt.exists && Array.from(afterMintedAttempt.data)).toEqual(
      Array.from(secondConditionHead.data),
    );
    client.svm.expireBlockhash();
    await expect(client.sendTransaction([followupCondition()])).rejects.toThrow();
    const afterDuplicateCondition = client.svm.getAccount(conditionHead);
    expect(
      afterDuplicateCondition.exists && Array.from(afterDuplicateCondition.data),
    ).toEqual(Array.from(secondConditionHead.data));

    client.svm.airdrop(custody.address, lamports(2_000_000_000n));
    const collectorA = (await generateKeyPairSigner()).address;
    const collectorB = (await generateKeyPairSigner()).address;
    const custodyPdas = async (art: Address, revision: bigint) => {
      const [head] = await getProgramDerivedAddress({
        programAddress: REGISTRY,
        seeds: [new TextEncoder().encode("custody"), getAddressEncoder().encode(art)],
      });
      const revisionBytes = new Uint8Array(8);
      new DataView(revisionBytes.buffer).setBigUint64(0, revision, true);
      const [transition] = await getProgramDerivedAddress({
        programAddress: REGISTRY,
        seeds: [
          new TextEncoder().encode("custody-transition"),
          getAddressEncoder().encode(art),
          revisionBytes,
        ],
      });
      return { head, transition };
    };
    const custody1 = await custodyPdas(artwork, 1n);
    const custody2 = await custodyPdas(artwork, 2n);
    const custody3 = await custodyPdas(artwork, 3n);
    const custody4 = await custodyPdas(artwork, 4n);
    const custody5 = await custodyPdas(artwork, 5n);
    const otherCustody1 = await custodyPdas(otherArtwork, 1n);
    const custodyTx = (
      action: "initialize_custody" | "transition_custody",
      custodyAction: number,
      collector?: Address,
      expectedRevision = 0n,
      nextRevision = 0n,
      art = artwork,
      head = custody1.head,
      transition = custody1.transition,
      authority = custody.address,
      configAddress = pdas.config,
    ) =>
      addSignersToInstruction(
        [authority === custody.address ? custody : wrongSigner],
        custodyInstruction(
          action,
          configAddress,
          art,
          head,
          transition,
          authority,
          custodyAction,
          collector,
          expectedRevision,
          nextRevision,
        ),
      );
    const initialCustody = (
      custodyAction = 0,
      collector?: Address,
      art = artwork,
      head = custody1.head,
      transition = custody1.transition,
      authority = custody.address,
      configAddress = pdas.config,
    ) =>
      custodyTx(
        "initialize_custody",
        custodyAction,
        collector,
        0n,
        0n,
        art,
        head,
        transition,
        authority,
        configAddress,
      );
    const moveCustody = (
      expectedRevision: bigint,
      nextRevision: bigint,
      custodyAction: number,
      transition: Address,
      collector?: Address,
      art = artwork,
      head = custody1.head,
      authority = custody.address,
      configAddress = pdas.config,
    ) =>
      custodyTx(
        "transition_custody",
        custodyAction,
        collector,
        expectedRevision,
        nextRevision,
        art,
        head,
        transition,
        authority,
        configAddress,
      );
    const custodyAbsent = () => {
      expect(client.svm.getAccount(custody1.head).exists).toBe(false);
      expect(client.svm.getAccount(custody1.transition).exists).toBe(false);
    };
    for (const invalid of [
      initialCustody(
        0,
        undefined,
        artwork,
        custody1.head,
        custody1.transition,
        wrongSigner.address,
      ),
      initialCustody(
        0,
        undefined,
        artwork,
        custody1.head,
        custody1.transition,
        custody.address,
        wrongSigner.address,
      ),
      initialCustody(0, undefined, wrongArtwork),
      initialCustody(2),
      initialCustody(0, collectorA),
      initialCustody(1),
      initialCustody(1, SYSTEM),
      initialCustody(1, custody.address),
      initialCustody(0, undefined, artwork, custody1.head, custody2.transition),
    ]) {
      await expect(client.sendTransaction([invalid])).rejects.toThrow();
      custodyAbsent();
    }
    client.svm.setAccount({ ...record, data: wrongCollectionData });
    await expect(client.sendTransaction([initialCustody()])).rejects.toThrow();
    custodyAbsent();
    client.svm.setAccount(record);
    client.svm.expireBlockhash();
    await client.sendTransaction([initialCustody()]);
    const head1 = client.svm.getAccount(custody1.head);
    const event1 = client.svm.getAccount(custody1.transition);
    if (!head1.exists || !event1.exists) throw new Error("Initial custody missing");
    expect(head1.data.length).toBe(115);
    expect(event1.data.length).toBe(158);
    expect(getAddressDecoder().decode(head1.data.subarray(8, 40))).toBe(artwork);
    expect(
      new DataView(head1.data.buffer, head1.data.byteOffset).getBigUint64(40, true),
    ).toBe(1n);
    expect(head1.data[48]).toBe(1); // Katha held.
    expect(head1.data[49]).toBe(1); // Named custodian.
    expect(getAddressDecoder().decode(head1.data.subarray(50, 82))).toBe(
      custody.address,
    );
    expect(getAddressDecoder().decode(head1.data.subarray(82, 114))).toBe(
      custody1.transition,
    );
    expect(event1.data[48]).toBe(0); // Initial Katha custody action.
    expect(event1.data[49]).toBe(0); // Unknown before first attestation.
    expect(event1.data[50]).toBe(1); // Katha held after attestation.
    await expect(client.sendTransaction([initialCustody()])).rejects.toThrow();
    const unchangedAt = (expected: typeof head1, transition: Address) => {
      const current = client.svm.getAccount(custody1.head);
      expect(current.exists && Array.from(current.data)).toEqual(
        Array.from(expected.data),
      );
      expect(client.svm.getAccount(transition).exists).toBe(false);
    };
    for (const invalid of [
      moveCustody(1n, 2n, 3, custody2.transition), // Collector dispatch from Katha is invalid.
      moveCustody(1n, 2n, 4, custody2.transition), // Receipt requires transit.
      moveCustody(1n, 2n, 2, custody2.transition, collectorA),
      moveCustody(0n, 2n, 2, custody2.transition),
      moveCustody(1n, 3n, 2, custody2.transition),
      moveCustody(
        1n,
        2n,
        2,
        custody2.transition,
        undefined,
        artwork,
        custody1.head,
        wrongSigner.address,
      ),
      moveCustody(
        1n,
        2n,
        2,
        custody2.transition,
        undefined,
        artwork,
        custody1.head,
        custody.address,
        wrongSigner.address,
      ),
      moveCustody(1n, 2n, 2, custody2.transition, undefined, otherArtwork),
      moveCustody(1n, 2n, 2, custody3.transition),
    ]) {
      await expect(client.sendTransaction([invalid])).rejects.toThrow();
      unchangedAt(head1, custody2.transition);
    }
    const forgedCustodyHead = Uint8Array.from(head1.data);
    forgedCustodyHead.set(getAddressEncoder().encode(otherArtwork), 8);
    client.svm.setAccount({ ...head1, data: forgedCustodyHead });
    await expect(
      client.sendTransaction([moveCustody(1n, 2n, 2, custody2.transition)]),
    ).rejects.toThrow();
    client.svm.setAccount(head1);
    unchangedAt(head1, custody2.transition);
    client.svm.expireBlockhash();
    await client.sendTransaction([moveCustody(1n, 2n, 2, custody2.transition)]);
    const head2 = client.svm.getAccount(custody1.head);
    const event2 = client.svm.getAccount(custody2.transition);
    if (!head2.exists || !event2.exists) throw new Error("Dispatch missing");
    expect(
      new DataView(head2.data.buffer, head2.data.byteOffset).getBigUint64(40, true),
    ).toBe(2n);
    expect(head2.data[48]).toBe(3); // Transit, with no asserted custodian.
    expect(head2.data[49]).toBe(0);
    expect(event2.data[48]).toBe(2); // Dispatch from Katha.
    expect(event2.data[49]).toBe(1);
    expect(event2.data[50]).toBe(3);
    expect(event2.data[51]).toBe(1); // Preserved previous Katha subject.
    expect(getAddressDecoder().decode(event2.data.subarray(52, 84))).toBe(
      custody.address,
    );
    for (const invalid of [
      moveCustody(2n, 3n, 5, custody3.transition),
      moveCustody(2n, 3n, 5, custody3.transition, SYSTEM),
      moveCustody(2n, 3n, 5, custody3.transition, custody.address),
      moveCustody(2n, 3n, 4, custody3.transition, collectorA),
      moveCustody(2n, 3n, 2, custody3.transition),
    ]) {
      await expect(client.sendTransaction([invalid])).rejects.toThrow();
      unchangedAt(head2, custody3.transition);
    }
    await client.sendTransaction([
      moveCustody(2n, 3n, 5, custody3.transition, collectorA),
    ]);
    const head3 = client.svm.getAccount(custody1.head);
    if (!head3.exists) throw new Error("Collector receipt missing");
    expect(head3.data[48]).toBe(2);
    expect(getAddressDecoder().decode(head3.data.subarray(50, 82))).toBe(collectorA);
    await client.sendTransaction([moveCustody(3n, 4n, 3, custody4.transition)]);
    const head4 = client.svm.getAccount(custody1.head);
    if (!head4.exists) throw new Error("Collector dispatch missing");
    expect(head4.data[48]).toBe(3);
    const event4 = client.svm.getAccount(custody4.transition);
    if (!event4.exists) throw new Error("Collector dispatch event missing");
    expect(getAddressDecoder().decode(event4.data.subarray(52, 84))).toBe(collectorA);
    await client.sendTransaction([moveCustody(4n, 5n, 4, custody5.transition)]);
    const head5 = client.svm.getAccount(custody1.head);
    if (!head5.exists) throw new Error("Katha receipt missing");
    expect(head5.data[48]).toBe(1);
    expect(getAddressDecoder().decode(head5.data.subarray(50, 82))).toBe(
      custody.address,
    );
    expect(client.svm.getAccount(custody1.transition)).toEqual(event1);
    expect(client.svm.getAccount(custody2.transition)).toEqual(event2);
    client.svm.expireBlockhash();
    await expect(
      client.sendTransaction([moveCustody(4n, 5n, 4, custody5.transition)]),
    ).rejects.toThrow();
    const custodyAfterReplay = client.svm.getAccount(custody1.head);
    expect(custodyAfterReplay.exists && Array.from(custodyAfterReplay.data)).toEqual(
      Array.from(head5.data),
    );

    // The other registered artwork can start in collector custody independently.
    await client.sendTransaction([
      initialCustody(
        1,
        collectorB,
        otherArtwork,
        otherCustody1.head,
        otherCustody1.transition,
      ),
    ]);
    const otherHead = client.svm.getAccount(otherCustody1.head);
    if (!otherHead.exists) throw new Error("Other artwork custody missing");
    expect(otherHead.data[48]).toBe(2);
    expect(getAddressDecoder().decode(otherHead.data.subarray(50, 82))).toBe(
      collectorB,
    );
    const unchangedArtwork = client.svm.getAccount(artwork);
    expect(unchangedArtwork.exists && Array.from(unchangedArtwork.data)).toEqual(
      Array.from(record.data),
    );
    const unchangedVerification = client.svm.getAccount(verification);
    expect(
      unchangedVerification.exists && Array.from(unchangedVerification.data),
    ).toEqual(Array.from(attestation.data));
    const unchangedCondition = client.svm.getAccount(conditionHead);
    expect(unchangedCondition.exists && Array.from(unchangedCondition.data)).toEqual(
      Array.from(secondConditionHead.data),
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
