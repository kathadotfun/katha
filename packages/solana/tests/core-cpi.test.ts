import { createHash } from "node:crypto";
import {
  createClient,
  addSignersToInstruction,
  AccountRole,
  address,
  generateKeyPairSigner,
  fetchEncodedAccount,
  lamports,
} from "@solana/kit";
import type { Address } from "@solana/kit";
import { litesvm } from "@solana/kit-plugin-litesvm";
import { signer } from "@solana/kit-plugin-signer";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { describe, expect, it } from "vitest";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";

const REGISTRY_PROGRAM_ADDRESS = address(
  "Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr",
);
const SYSTEM_PROGRAM_ADDRESS = address("11111111111111111111111111111111");
const coreBinary = process.env.KATHA_TEST_CORE_SO;
const registryBinary = process.env.KATHA_TEST_REGISTRY_SO;
if (!coreBinary || !registryBinary) {
  throw new Error("Core CPI program binaries must be provided by pnpm program:test");
}

function encodeText(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const encoded = new Uint8Array(4 + bytes.length);
  new DataView(encoded.buffer).setUint32(0, bytes.length, true);
  encoded.set(bytes, 4);
  return encoded;
}

function probeInstruction(
  collectionAddress: ReturnType<typeof address>,
  payerAddress: ReturnType<typeof address>,
  coreProgramAddress: Address = CORE_PROGRAM_ADDRESS,
) {
  const name = encodeText("Katha CPI fixture");
  const uri = encodeText("https://katha.fun/test/core-cpi.json");
  const discriminator = createHash("sha256")
    .update("global:probe_create_core_collection")
    .digest()
    .subarray(0, 8);
  return {
    programAddress: REGISTRY_PROGRAM_ADDRESS,
    accounts: [
      { address: collectionAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: payerAddress, role: AccountRole.READONLY },
      { address: payerAddress, role: AccountRole.WRITABLE_SIGNER },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: coreProgramAddress, role: AccountRole.READONLY },
    ],
    data: Uint8Array.from([...discriminator, ...name, ...uri]),
  };
}

describe("real Core CPI in LiteSVM", () => {
  it("creates a real collection and rejects duplicate, missing signature, and wrong Core program", async () => {
    const payer = await generateKeyPairSigner();
    const collection = await generateKeyPairSigner();
    const client = createClient()
      .use(signer(payer))
      .use(litesvm({ transactionConfig: { version: 0 } }));
    client.svm.addProgramFromFile(CORE_PROGRAM_ADDRESS, coreBinary);
    client.svm.addProgramFromFile(REGISTRY_PROGRAM_ADDRESS, registryBinary);
    client.svm.airdrop(payer.address, lamports(5_000_000_000n));

    const create = addSignersToInstruction(
      [collection],
      probeInstruction(collection.address, payer.address),
    );
    const created = await client.sendTransaction([create]);
    expect(created.context.signature).toBeTruthy();
    const account = client.svm.getAccount(collection.address);
    expect(account.exists).toBe(true);
    if (!account.exists) throw new Error("Core collection was not created");
    expect(account.programAddress).toBe(CORE_PROGRAM_ADDRESS);
    expect(account.data[0]).toBe(5);

    await expect(client.sendTransaction([create])).rejects.toThrow();
    const stillOwned = client.svm.getAccount(collection.address);
    expect(stillOwned.exists && stillOwned.programAddress).toBe(CORE_PROGRAM_ADDRESS);

    const unsignedCollection = await generateKeyPairSigner();
    const missingSigner = probeInstruction(unsignedCollection.address, payer.address);
    missingSigner.accounts[0] = {
      address: unsignedCollection.address,
      role: AccountRole.WRITABLE,
    };
    await expect(client.sendTransaction([missingSigner])).rejects.toThrow();
    expect(client.svm.getAccount(unsignedCollection.address).exists).toBe(false);

    const wrongCoreCollection = await generateKeyPairSigner();
    const wrongCore = addSignersToInstruction(
      [wrongCoreCollection],
      probeInstruction(
        wrongCoreCollection.address,
        payer.address,
        SYSTEM_PROGRAM_ADDRESS,
      ),
    );
    await expect(client.sendTransaction([wrongCore])).rejects.toThrow();
    expect(client.svm.getAccount(wrongCoreCollection.address).exists).toBe(false);
  });
});

describe("real Core CPI in Surfpool", () => {
  it("creates a collection and rejects duplicate, missing signature, and wrong program", async () => {
    const rpcUrl = process.env.KATHA_TEST_SURFPOOL_RPC;
    const wsUrl = process.env.KATHA_TEST_SURFPOOL_WS;
    if (!rpcUrl || !wsUrl)
      throw new Error("Surfpool endpoints must be supplied by pnpm program:test");
    const payer = await generateKeyPairSigner();
    const collection = await generateKeyPairSigner();
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "surfnet_setAccount",
        params: [payer.address, { lamports: 5_000_000_000 }],
      }),
    });
    const funded = await response.json();
    if (funded.error) throw new Error(JSON.stringify(funded.error));
    const client = createClient()
      .use(signer(payer))
      .use(
        solanaRpc({
          rpcUrl,
          rpcSubscriptionsUrl: wsUrl,
          transactionConfig: { version: 0 },
        }),
      );
    const create = addSignersToInstruction(
      [collection],
      probeInstruction(collection.address, payer.address),
    );
    const created = await client.sendTransaction([create]);
    expect(created.context.signature).toBeTruthy();
    const account = await fetchEncodedAccount(client.rpc, collection.address);
    expect(account.exists).toBe(true);
    if (!account.exists) throw new Error("Core collection was not created");
    expect(account.programAddress).toBe(CORE_PROGRAM_ADDRESS);
    expect(account.data[0]).toBe(5);
    await expect(client.sendTransaction([create])).rejects.toThrow();
    const stillOwned = await fetchEncodedAccount(client.rpc, collection.address);
    expect(stillOwned.exists && stillOwned.programAddress).toBe(CORE_PROGRAM_ADDRESS);

    const unsignedCollection = await generateKeyPairSigner();
    const missingSigner = probeInstruction(unsignedCollection.address, payer.address);
    missingSigner.accounts[0] = {
      address: unsignedCollection.address,
      role: AccountRole.WRITABLE,
    };
    await expect(client.sendTransaction([missingSigner])).rejects.toThrow();
    expect(
      (await fetchEncodedAccount(client.rpc, unsignedCollection.address)).exists,
    ).toBe(false);

    const wrongCoreCollection = await generateKeyPairSigner();
    const wrongCore = addSignersToInstruction(
      [wrongCoreCollection],
      probeInstruction(
        wrongCoreCollection.address,
        payer.address,
        SYSTEM_PROGRAM_ADDRESS,
      ),
    );
    await expect(client.sendTransaction([wrongCore])).rejects.toThrow();
    expect(
      (await fetchEncodedAccount(client.rpc, wrongCoreCollection.address)).exists,
    ).toBe(false);
  });
});
