import { sha256Hex } from "@katha/shared";
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type MaybeEncodedAccount,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { assertOwnedEncodedAccount } from "./client.js";

const LOADER = address("BPFLoaderUpgradeab1e11111111111111111111111");
const SYSTEM = address("11111111111111111111111111111111");
export async function findUpgradeableProgramDataAddress(program: string) {
  return (
    await getProgramDerivedAddress({
      programAddress: LOADER,
      seeds: [getAddressEncoder().encode(address(program))],
    })
  )[0];
}

/** Read-only loader-v3 inspection. No signer, keypair file or transaction submission. */
export async function inspectUpgradeableProgram(
  programAddress: string,
  program: MaybeEncodedAccount,
  data: MaybeEncodedAccount,
  localBinary?: ReadonlyUint8Array,
) {
  const key = address(programAddress);
  const programData = await findUpgradeableProgramDataAddress(key);
  assertOwnedEncodedAccount(program, key, LOADER, 36);
  assertOwnedEncodedAccount(data, programData, LOADER, 45);
  const tag = (bytes: ReadonlyUint8Array) =>
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  if (
    !program.executable ||
    program.data.length !== 36 ||
    tag(program.data) !== 2 ||
    getAddressDecoder().decode(program.data.subarray(4, 36)) !== programData ||
    data.executable ||
    tag(data.data) !== 3 ||
    data.data[12] !== 1
  )
    throw new TypeError("Invalid or immutable upgradeable program");
  const authority = getAddressDecoder().decode(data.data.subarray(13, 45));
  if (authority === SYSTEM) throw new TypeError("Invalid upgrade authority");
  const payload = data.data.subarray(45);
  const deploymentSlot = new DataView(
    data.data.buffer,
    data.data.byteOffset,
  ).getBigUint64(4, true);
  const local = localBinary && Uint8Array.from(localBinary);
  if (
    local &&
    (local.length < 4 ||
      local.length > 10 * 1024 * 1024 ||
      ![127, 69, 76, 70].every((v, i) => local[i] === v))
  )
    throw new TypeError("Expected a bounded SBF ELF binary");
  const matchesLocal = local
    ? payload.length >= local.length &&
      local.every((v, i) => payload[i] === v) &&
      payload.subarray(local.length).every((v) => v === 0)
    : null;
  return {
    program: key,
    programData,
    authority,
    deploymentSlot: deploymentSlot.toString(),
    capacity: payload.length,
    deployedPayloadSha256: await sha256Hex(Uint8Array.from(payload)),
    matchesLocal,
    localSha256: local ? await sha256Hex(local) : null,
    localBytes: local?.length ?? null,
    additionalBytesRequired: local ? Math.max(0, local.length - payload.length) : null,
  };
}

/** A prepared upgrade remains a wallet-approved loader instruction, never an automatic deploy. */
export async function prepareProgramUpgrade(
  input: {
    program: Address;
    operator: Address;
    buffer: Address;
    spill: Address;
    binarySha256: string;
    binaryBytes: number;
  },
  read: (key: Address) => Promise<MaybeEncodedAccount>,
): Promise<Instruction> {
  if (
    !/^[0-9a-f]{64}$/.test(input.binarySha256) ||
    !Number.isSafeInteger(input.binaryBytes) ||
    input.binaryBytes < 4 ||
    input.binaryBytes > 10 * 1024 * 1024 ||
    [input.operator, input.buffer, input.spill].includes(SYSTEM) ||
    input.buffer === input.spill ||
    input.program === input.spill
  )
    throw new TypeError("Invalid public upgrade inputs");
  const program = await read(input.program);
  const [programData] = await getProgramDerivedAddress({
    programAddress: LOADER,
    seeds: [getAddressEncoder().encode(input.program)],
  });
  const data = await read(programData);
  const inspected = await inspectUpgradeableProgram(input.program, program, data);
  if (inspected.authority !== input.operator || input.spill === programData)
    throw new TypeError("Connected wallet is not the current upgrade authority");
  const buffer = await read(input.buffer);
  assertOwnedEncodedAccount(buffer, input.buffer, LOADER, 41);
  if (
    buffer.executable ||
    new DataView(buffer.data.buffer, buffer.data.byteOffset).getUint32(0, true) !== 1 ||
    buffer.data[4] !== 1 ||
    getAddressDecoder().decode(buffer.data.subarray(5, 37)) !== input.operator ||
    ![127, 69, 76, 70].every((v, i) => buffer.data[i + 37] === v) ||
    buffer.data.length - 37 > inspected.capacity ||
    buffer.data.length - 37 < input.binaryBytes ||
    !buffer.data.subarray(37 + input.binaryBytes).every((v) => v === 0) ||
    (await sha256Hex(
      Uint8Array.from(buffer.data.subarray(37, 37 + input.binaryBytes)),
    )) !== input.binarySha256
  )
    throw new TypeError(
      "Upgrade buffer authority, ELF, capacity or reviewed SHA-256 does not match",
    );
  return {
    programAddress: LOADER,
    accounts: [
      { address: programData, role: AccountRole.WRITABLE },
      { address: input.program, role: AccountRole.WRITABLE },
      { address: input.buffer, role: AccountRole.WRITABLE },
      { address: input.spill, role: AccountRole.WRITABLE },
      {
        address: address("SysvarRent111111111111111111111111111111111"),
        role: AccountRole.READONLY,
      },
      {
        address: address("SysvarC1ock11111111111111111111111111111111"),
        role: AccountRole.READONLY,
      },
      { address: input.operator, role: AccountRole.READONLY_SIGNER },
    ],
    data: Uint8Array.of(3, 0, 0, 0),
  };
}
