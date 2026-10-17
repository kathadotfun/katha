import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type EncodedAccount,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { assertOwnedEncodedAccount } from "./client.js";

export const SQUADS_V4_PROGRAM = address("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");
const encoder = getAddressEncoder(),
  decoder = getAddressDecoder();
const text = (value: string) => new TextEncoder().encode(value);
const zero = address("11111111111111111111111111111111");

/** Bounded external schema pinned to Squads v4 af94153ff77a28b6effe46b9c94baaa93742b48c. */
export async function inspectSquadsVault(account: EncodedAccount, vaultIndex: number) {
  assertOwnedEncodedAccount(account, account.address, SQUADS_V4_PROGRAM, 199);
  if (
    account.executable ||
    account.data.length > 4096 ||
    !Number.isInteger(vaultIndex) ||
    vaultIndex < 0 ||
    vaultIndex > 255
  )
    throw new TypeError("Invalid Squads account or vault index");
  const bytes = account.data;
  let offset = 0;
  const take = (size: number) => {
    if (offset + size > bytes.length) throw new TypeError("Truncated Squads state");
    const part = bytes.subarray(offset, offset + size);
    offset += size;
    return part;
  };
  const number = (size: 1 | 2 | 4 | 8) => {
    const part = take(size),
      view = new DataView(part.buffer, part.byteOffset, part.length);
    return size === 8
      ? view.getBigUint64(0, true)
      : BigInt(
          size === 4
            ? view.getUint32(0, true)
            : size === 2
              ? view.getUint16(0, true)
              : part[0]!,
        );
  };
  if (!take(8).every((value, i) => value === [224, 116, 121, 186, 68, 161, 79, 236][i]))
    throw new TypeError("Invalid Squads discriminator");
  const createKey = take(32);
  if (!take(32).every((value) => value === 0) || number(2) !== 2n)
    throw new TypeError("An autonomous two-of-three Squad is required");
  const timeLock = Number(number(4)),
    transactionIndex = number(8),
    staleIndex = number(8);
  if (timeLock > 7776000 || staleIndex > transactionIndex)
    throw new TypeError("Invalid Squads delay or revision");
  const rentCollector = number(1);
  if (rentCollector === 1n) take(32);
  else if (rentCollector !== 0n) throw new TypeError("Invalid Squads rent collector");
  const bump = Number(number(1));
  if (number(4) !== 3n)
    throw new TypeError("Exactly three Squads members are required");
  const member = () => {
    const key = decoder.decode(take(32));
    if (key === zero || number(1) !== 7n)
      throw new TypeError("Every member must initiate, approve and execute");
    return key;
  };
  const members: [Address, Address, Address] = [member(), member(), member()];
  const compare = (a: Address, b: Address) => {
    const left = encoder.encode(a),
      right = encoder.encode(b);
    for (let i = 0; i < 32; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
    return 0;
  };
  if (compare(members[0], members[1]) >= 0 || compare(members[1], members[2]) >= 0)
    throw new TypeError("Squads members must be distinct and canonical");
  const [multisig, expectedBump] = await getProgramDerivedAddress({
    programAddress: SQUADS_V4_PROGRAM,
    seeds: [text("multisig"), text("multisig"), createKey],
  });
  if (multisig !== account.address || bump !== expectedBump)
    throw new TypeError("Noncanonical Squads account");
  const [vault] = await getProgramDerivedAddress({
    programAddress: SQUADS_V4_PROGRAM,
    seeds: [
      text("multisig"),
      encoder.encode(multisig),
      text("vault"),
      Uint8Array.of(vaultIndex),
    ],
  });
  return Object.freeze({
    multisig,
    vault,
    vaultIndex,
    threshold: 2 as const,
    members,
    timeLock,
    transactionIndex,
  });
}

/** Squads' compact message format, not a serialized Solana wire transaction. */
export function compileSquadsMessage(
  vault: Address,
  instructions: readonly Instruction[],
) {
  if (vault === zero || instructions.length === 0 || instructions.length > 255)
    throw new TypeError("Invalid Squads instruction count");
  const roles = new Map<Address, AccountRole>([[vault, AccountRole.WRITABLE_SIGNER]]);
  for (const instruction of instructions) {
    for (const account of instruction.accounts ?? []) {
      address(account.address);
      if (![0, 1, 2, 3].includes(account.role))
        throw new TypeError("Invalid account role");
      roles.set(account.address, (roles.get(account.address) ?? 0) | account.role);
    }
    if (!roles.has(instruction.programAddress))
      roles.set(address(instruction.programAddress), AccountRole.READONLY);
  }
  const rank = (role: AccountRole) =>
    role === 3 ? 0 : role === 2 ? 1 : role === 1 ? 2 : 3;
  const keys = [...roles.keys()].sort((a, b) =>
    a === vault ? -1 : b === vault ? 1 : rank(roles.get(a)!) - rank(roles.get(b)!),
  );
  if (keys.length > 255) throw new TypeError("Squads message has too many accounts");
  const parts: ReadonlyUint8Array[] = [
    Uint8Array.of(
      keys.filter((key) => roles.get(key)! >= 2).length,
      keys.filter((key) => roles.get(key) === 3).length,
      keys.filter((key) => roles.get(key) === 1).length,
      keys.length,
    ),
    ...keys.map((key) => encoder.encode(key)),
    Uint8Array.of(instructions.length),
  ];
  for (const instruction of instructions) {
    const accounts = instruction.accounts ?? [],
      data = instruction.data ?? new Uint8Array();
    if (accounts.length > 255 || data.length > 65535)
      throw new TypeError("Squads instruction exceeds compact limits");
    const length = new Uint8Array(2);
    new DataView(length.buffer).setUint16(0, data.length, true);
    parts.push(
      Uint8Array.of(keys.indexOf(instruction.programAddress), accounts.length),
      Uint8Array.from(accounts.map((account) => keys.indexOf(account.address))),
      length,
      data,
    );
  }
  parts.push(Uint8Array.of(0));
  const message = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }
  return {
    message,
    remainingAccounts: keys.map((key) => ({
      address: key,
      role: key === vault ? AccountRole.WRITABLE : roles.get(key)!,
    })),
    requiredExecutionSigners: keys.filter(
      (key) => key !== vault && roles.get(key)! >= 2,
    ),
  };
}
