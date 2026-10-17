import {
  AccountRole,
  address,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
  lamports,
  type EncodedAccount,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  compileSquadsMessage,
  inspectSquadsVault,
  SQUADS_V4_PROGRAM,
} from "../src/squads.js";

const encoder = getAddressEncoder();
const key = (value: number) =>
  getAddressDecoder().decode(new Uint8Array(32).fill(value));

async function fixture() {
  const createKey = encoder.encode(key(9));
  const [multisig, bump] = await getProgramDerivedAddress({
    programAddress: SQUADS_V4_PROGRAM,
    seeds: [
      new TextEncoder().encode("multisig"),
      new TextEncoder().encode("multisig"),
      createKey,
    ],
  });
  const bytes = new Uint8Array(199),
    view = new DataView(bytes.buffer);
  bytes.set([224, 116, 121, 186, 68, 161, 79, 236]);
  bytes.set(createKey, 8);
  view.setUint16(72, 2, true);
  bytes[95] = bump;
  view.setUint32(96, 3, true);
  for (let i = 0; i < 3; i++) {
    bytes.set(encoder.encode(key(i + 1)), 100 + i * 33);
    bytes[132 + i * 33] = 7;
  }
  const account: EncodedAccount & { exists: true } = {
    exists: true,
    address: multisig,
    programAddress: SQUADS_V4_PROGRAM,
    data: bytes,
    executable: false,
    lamports: lamports(1n),
    space: 199n,
  };
  return account;
}
describe("reviewed Squads state", () => {
  it("derives the canonical vault from an autonomous two-of-three account", async () => {
    const result = await inspectSquadsVault(await fixture(), 0);
    expect(result.members).toEqual([key(1), key(2), key(3)]);
    expect(result.threshold).toBe(2);
    expect(result.timeLock).toBe(0);
  });
  it.each([
    "owner",
    "discriminator",
    "controller",
    "threshold",
    "permissions",
    "duplicate",
    "bump",
    "length",
    "stale",
  ])("rejects invalid %s", async (change) => {
    const account = await fixture(),
      data = Uint8Array.from(account.data);
    let changed = { ...account, data };
    if (change === "owner") changed = { ...changed, programAddress: key(8) };
    if (change === "discriminator") data[0] = 0;
    if (change === "controller") data[40] = 1;
    if (change === "threshold") data[72] = 1;
    if (change === "permissions") data[132] = 3;
    if (change === "duplicate") data.set(encoder.encode(key(1)), 133);
    if (change === "bump") data[95] = (data[95]! + 1) % 256;
    if (change === "length") changed = { ...changed, data: data.subarray(0, 198) };
    if (change === "stale") data[86] = 1;
    await expect(inspectSquadsVault(changed, 0)).rejects.toThrow();
  });
  it("compiles signer privileges and exposes required external co-signers", () => {
    const vault = key(1),
      external = key(2),
      program = key(3);
    const result = compileSquadsMessage(vault, [
      {
        programAddress: program,
        accounts: [
          { address: vault, role: AccountRole.READONLY_SIGNER },
          { address: external, role: AccountRole.READONLY_SIGNER },
          { address: external, role: AccountRole.WRITABLE },
        ],
        data: Uint8Array.of(42),
      },
    ]);
    expect(result.requiredExecutionSigners).toEqual([external]);
    expect(result.remainingAccounts).toEqual([
      { address: vault, role: AccountRole.WRITABLE },
      { address: external, role: AccountRole.WRITABLE_SIGNER },
      { address: program, role: AccountRole.READONLY },
    ]);
    expect([...result.message.subarray(0, 4)]).toEqual([2, 2, 0, 3]);
    expect(() =>
      compileSquadsMessage(address("11111111111111111111111111111111"), []),
    ).toThrow();
  });
});
