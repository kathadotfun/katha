import { expect, it } from "vitest";
import { sha256Hex } from "@katha/shared";
import {
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  lamports,
  type Address,
  type MaybeEncodedAccount,
} from "@solana/kit";
import {
  findUpgradeableProgramDataAddress,
  inspectUpgradeableProgram,
  prepareProgramUpgrade,
} from "../src/program-upgrade.js";
import { KATHA_REGISTRY_PROGRAM_ADDRESS as program } from "../src/generated/registry/index.js";
const loader = address("BPFLoaderUpgradeab1e11111111111111111111111");

async function fixture() {
  const operator = (await generateKeyPairSigner()).address,
    buffer = (await generateKeyPairSigner()).address,
    spill = (await generateKeyPairSigner()).address;
  const programData = await findUpgradeableProgramDataAddress(program);
  const binary = Uint8Array.of(127, 69, 76, 70, 1, 2, 3, 4);
  const encoded = getAddressEncoder();
  const programBytes = new Uint8Array(36);
  programBytes[0] = 2;
  programBytes.set(encoded.encode(programData), 4);
  const data = new Uint8Array(45 + binary.length + 8);
  data[0] = 3;
  data[12] = 1;
  data.set(encoded.encode(operator), 13);
  data.set(binary, 45);
  const bufferBytes = new Uint8Array(37 + binary.length);
  bufferBytes[0] = 1;
  bufferBytes[4] = 1;
  bufferBytes.set(encoded.encode(operator), 5);
  bufferBytes.set(binary, 37);
  const account = (key: Address, bytes: Uint8Array, executable = false) => ({
    exists: true as const,
    address: key,
    programAddress: loader as Address,
    executable,
    data: bytes,
    space: BigInt(bytes.length),
    lamports: lamports(10000000n),
  });
  const programAccount = account(program, programBytes, true),
    dataAccount = account(programData, data),
    bufferAccount = account(buffer, bufferBytes);
  const read = async (key: Address): Promise<MaybeEncodedAccount> =>
    key === program
      ? programAccount
      : key === programData
        ? dataAccount
        : bufferAccount;
  const input = {
    program,
    operator,
    buffer,
    spill,
    binarySha256: await sha256Hex(binary),
    binaryBytes: binary.length,
  };
  return {
    input,
    read,
    programAccount,
    dataAccount,
    bufferAccount,
    binary,
    programData,
  };
}

it("matches the reviewed binary while tolerating only loader capacity padding", async () => {
  const f = await fixture();
  expect(
    await inspectUpgradeableProgram(program, f.programAccount, f.dataAccount, f.binary),
  ).toMatchObject({
    matchesLocal: true,
    localSha256: f.input.binarySha256,
    additionalBytesRequired: 0,
  });
  f.dataAccount.data[f.dataAccount.data.length - 1] = 1;
  expect(
    (
      await inspectUpgradeableProgram(
        program,
        f.programAccount,
        f.dataAccount,
        f.binary,
      )
    ).matchesLocal,
  ).toBe(false);
});

it("prepares the exact loader upgrade account order and sole authority signer", async () => {
  const f = await fixture();
  const ix = await prepareProgramUpgrade(f.input, f.read);
  expect(ix.programAddress).toBe(loader);
  expect([...ix.data!]).toEqual([3, 0, 0, 0]);
  expect(ix.accounts?.map((a) => [a.address, a.role])).toEqual([
    [f.programData, 1],
    [program, 1],
    [f.input.buffer, 1],
    [f.input.spill, 1],
    ["SysvarRent111111111111111111111111111111111", 0],
    ["SysvarC1ock11111111111111111111111111111111", 0],
    [f.input.operator, 2],
  ]);
});

it.each([
  "program-owner",
  "pointer",
  "program-data-owner",
  "immutable",
  "authority",
  "buffer-authority",
  "hash",
  "length",
  "spill",
  "elf",
  "capacity",
])("rejects %s before requesting a signature", async (fault) => {
  const f = await fixture();
  if (fault === "program-owner") f.programAccount.programAddress = f.input.spill;
  if (fault === "pointer") f.programAccount.data[4] = f.programAccount.data[4]! ^ 1;
  if (fault === "program-data-owner") f.dataAccount.programAddress = f.input.spill;
  if (fault === "immutable") f.dataAccount.data[12] = 0;
  if (fault === "authority") f.input.operator = f.input.spill;
  if (fault === "buffer-authority")
    f.bufferAccount.data[5] = f.bufferAccount.data[5]! ^ 1;
  if (fault === "hash") f.input.binarySha256 = "0".repeat(64);
  if (fault === "length") f.input.binaryBytes++;
  if (fault === "spill") f.input.spill = f.programData;
  if (fault === "elf") f.bufferAccount.data[37] = 0;
  if (fault === "capacity") f.dataAccount.data = f.dataAccount.data.slice(0, 46);
  await expect(prepareProgramUpgrade(f.input, f.read)).rejects.toThrow();
});
