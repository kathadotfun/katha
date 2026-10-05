import { expect, it, vi } from "vitest";
import {
  generateKeyPairSigner,
  compileTransaction,
  signTransaction,
  getBase64EncodedWireTransaction,
  blockhash,
  type Rpc,
  type GetTransactionApi,
  type GetGenesisHashApi,
} from "@solana/kit";
import { canonicalDocumentBytes, sha256Hex } from "@katha/shared";
import {
  getRegisterArtworkInstructionAsync,
  ArtworkCategory,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
} from "../src/generated/registry/index.js";
import { unsignedMessage } from "../src/registration.js";
import { encodeUnsignedRegistryTransaction } from "../src/operation-preparation.js";
import {
  validateSignedPreparation,
  createOperationReceiptReaderFromRpc,
  type ReceiptPreparation,
} from "../src/operation-receipt.js";
async function fixture(version: 0 | 1 = 0) {
  const signer = await generateKeyPairSigner();
  const kathaId = "KATHA-PAUBHA-000001",
    id = "11111111-1111-4111-8111-111111111111";
  const instruction = await getRegisterArtworkInstructionAsync({
    registrationAuthority: signer,
    kathaId,
    artistId: id,
    creatorWallet: null,
    category: ArtworkCategory.Paubha,
    creationYear: 2026,
    authorshipEvidenceHash: new Uint8Array(32).fill(3),
  });
  const cluster = version === 1 ? "devnet" : "localnet";
  const prepared = unsignedMessage(
    {
      cluster,
      authorityAddress: signer.address,
      feePayerAddress: signer.address,
      supportedTransactionVersions: new Set([version]),
      lifetime: {
        blockhash: blockhash("11111111111111111111111111111111"),
        lastValidBlockHeight: 100n,
      },
      currentBlockHeight: 1n,
    },
    instruction,
  );
  const encoded = await encodeUnsignedRegistryTransaction(prepared);
  const expectedAccounts = [
      ...new Set([
        signer.address,
        instruction.programAddress,
        ...instruction.accounts.map((a) => a.address),
      ]),
    ].sort(),
    expectedHashes = ["03".repeat(32)];
  const canonicalRequest = new TextDecoder().decode(
    canonicalDocumentBytes({
      schemaVersion: 1,
      artworkId: id,
      kathaId,
      kind: "REGISTER_ARTWORK",
      idempotencyKey: "receipt-fixture",
      expectedAccounts,
      expectedHashes,
      parameters: {},
      cluster,
      walletId: id,
      authorityWallet: signer.address,
      feePayer: signer.address,
      programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
      instruction: {
        programAddress: instruction.programAddress,
        accounts: instruction.accounts.map(({ address, role }) => ({ address, role })),
        dataHex: Buffer.from(instruction.data).toString("hex"),
      },
    }),
  );
  const expected: ReceiptPreparation = {
    transactionBase64: encoded.transactionBase64,
    messageHash: encoded.messageHash,
    transactionVersion: version,
    canonicalRequest,
    requestHash: await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    wallet: signer.address,
    walletId: id,
    cluster,
    kind: "REGISTER_ARTWORK",
    artworkId: id,
    idempotencyKey: "receipt-fixture",
    programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
    expectedAccounts,
    expectedHashes,
  };
  const signedWire = getBase64EncodedWireTransaction(
    await signTransaction(
      [signer.keyPair],
      compileTransaction(prepared.transactionMessage),
    ),
  );
  const verified = await validateSignedPreparation(signedWire, expected);
  let result: unknown = {
    transaction: [signedWire, "base64"],
    version,
    slot: 9007199254740993n,
    blockTime: 1791158400n,
    meta: { err: null },
  };
  let genesis =
    cluster === "devnet"
      ? "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
      : "11111111111111111111111111111111";
  const getTransaction = vi.fn(() => ({ send: async () => result }));
  const getGenesisHash = vi.fn(() => ({ send: async () => genesis }));
  const read = createOperationReceiptReaderFromRpc(
    { getTransaction, getGenesisHash } as unknown as Rpc<
      GetTransactionApi & GetGenesisHashApi
    >,
    cluster,
  );
  return {
    expected,
    signedWire,
    verified,
    read,
    getTransaction,
    getGenesisHash,
    setResult: (v: unknown) => {
      result = v;
    },
    setGenesis: (v: string) => {
      genesis = v;
    },
  };
}
it.each([0, 1] as const)(
  "validates cryptographic signed v%s preparation and exact finalized message",
  async (version) => {
    const f = await fixture(version);
    expect((await f.read(f.verified.signature, f.signedWire)).status).toBe("FINALIZED");
    expect(f.getTransaction.mock.calls[0]).toMatchObject([
      f.verified.signature,
      {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 1,
      },
    ]);
  },
);
it.each([
  null,
  { meta: null },
  { meta: {} },
  { blockTime: null },
  { blockTime: 99999999999999n },
  { slot: -1n },
  { slot: 9223372036854775808n },
  { meta: { err: false } },
])("retains unknown for incomplete finalized evidence case %#", async (change) => {
  const f = await fixture();
  f.setResult(
    change === null
      ? null
      : {
          transaction: [f.signedWire, "base64"],
          version: 0,
          slot: 2n,
          blockTime: 1791158400n,
          meta: { err: null },
          ...change,
        },
  );
  expect((await f.read(f.verified.signature, f.signedWire)).status).toBe("UNKNOWN");
});
it("returns bounded failure only for a matched finalized transaction", async () => {
  const f = await fixture();
  f.setResult({
    transaction: [f.signedWire, "base64"],
    version: 0,
    slot: 2n,
    blockTime: null,
    meta: {
      err: { InstructionError: [0, "InvalidArgument"] },
      logMessages: ["PRIVATE"],
    },
  });
  expect(await f.read(f.verified.signature, f.signedWire)).toEqual({
    status: "FAILED",
    failureCode: "TRANSACTION_FAILED",
  });
});
it.each(["wire", "version", "genesis", "devnet-genesis"])(
  "rejects mismatched %s",
  async (reason) => {
    const f = await fixture(reason === "devnet-genesis" ? 1 : 0);
    if (reason === "wire") {
      const b = Buffer.from(f.signedWire, "base64");
      b[1] = b[1]! ^ 1;
      f.setResult({
        transaction: [b.toString("base64"), "base64"],
        version: 0,
        slot: 2n,
        blockTime: 1791158400n,
        meta: { err: null },
      });
    }
    if (reason === "version")
      f.setResult({
        transaction: [f.signedWire, "base64"],
        version: 1,
        slot: 2n,
        blockTime: 1791158400n,
        meta: { err: null },
      });
    if (reason === "genesis")
      f.setGenesis("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
    if (reason === "devnet-genesis") f.setGenesis("11111111111111111111111111111111");
    await expect(f.read(f.verified.signature, f.signedWire)).rejects.toThrow();
  },
);
it.each([
  "unsigned",
  "trailing",
  "kind",
  "commitments",
  "request",
  "version",
  "wallet",
])("rejects altered preparation %s", async (reason) => {
  const f = await fixture();
  let wire: string = f.signedWire;
  if (reason === "unsigned") wire = f.expected.transactionBase64;
  if (reason === "trailing")
    wire = Buffer.concat([Buffer.from(wire, "base64"), Buffer.from([1])]).toString(
      "base64",
    );
  if (reason === "kind") f.expected.kind = "MINT_ARTWORK";
  if (reason === "commitments") f.expected.expectedHashes = [];
  if (reason === "request") f.expected.canonicalRequest += " ";
  if (reason === "version") f.expected.transactionVersion = 1;
  if (reason === "wallet") f.expected.wallet = "11111111111111111111111111111111";
  await expect(validateSignedPreparation(wire, f.expected)).rejects.toThrow();
});

it.each(["roles", "kind"])(
  "rejects a self-consistently rehashed but mismatched %s intent",
  async (reason) => {
    const f = await fixture();
    const intent = JSON.parse(f.expected.canonicalRequest);
    if (reason === "roles") intent.instruction.accounts[0].role = 1;
    else {
      intent.kind = "MINT_ARTWORK";
      f.expected.kind = "MINT_ARTWORK";
    }
    f.expected.canonicalRequest = new TextDecoder().decode(
      canonicalDocumentBytes(intent),
    );
    f.expected.requestHash = await sha256Hex(
      new TextEncoder().encode(f.expected.canonicalRequest),
    );
    await expect(validateSignedPreparation(f.signedWire, f.expected)).rejects.toThrow();
  },
);
