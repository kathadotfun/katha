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

describe("Registry platform initialization in LiteSVM", () => {
  it("binds a fresh Core collection once and rejects forged bootstrap relationships", async () => {
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
