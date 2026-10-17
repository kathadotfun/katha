import { expect, it } from "vitest";
import * as registry from "../src/generated/registry/index.js";
import * as marketplace from "../src/generated/marketplace/index.js";
import { decodeFinalizedActivity } from "../src/chain-activity.js";
import {
  activityFixture,
  base58,
  ARTWORK,
  COLLECTION,
  OWNER,
  SIG,
  SLOT,
  SYSTEM,
} from "./fixtures/activity.js";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";

for (const market of [false, true]) {
  const label = market ? "Marketplace" : "Registry";
  const program = market
    ? marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS
    : registry.KATHA_REGISTRY_PROGRAM_ADDRESS;
  const eventCodec = market
    ? marketplace.getMarketplaceMultisigAuthorityTransferredEventCodec()
    : registry.getMultisigAuthorityTransferredEventCodec();
  const instructionCodec = market
    ? marketplace.getTransferMultisigAuthorityInstructionDataCodec()
    : registry.getTransferMultisigAuthorityInstructionDataCodec();
  const terms = {
    expectedAuthority: ARTWORK,
    vaultIndex: 0,
    expectedMembers: [SYSTEM, ARTWORK, OWNER],
    expectedTimeLock: 86400,
  };
  const event = {
    config: SYSTEM,
    previousAuthority: ARTWORK,
    authority: OWNER,
    multisig: COLLECTION,
    vaultIndex: terms.vaultIndex,
    members: terms.expectedMembers,
    timeLock: terms.expectedTimeLock,
  };
  const log = (data: ArrayLike<number>) =>
    `Program data: ${Buffer.from(data).toString("base64")}`;
  function fixture() {
    const f = activityFixture();
    f.transaction.message.accountKeys = [
      program,
      SYSTEM,
      ARTWORK,
      OWNER,
      COLLECTION,
      CORE_PROGRAM_ADDRESS,
    ];
    f.transaction.message.instructions = [
      {
        programIdIndex: 0,
        accounts: [1, 2, 3, 4, 0, 5],
        data: base58(instructionCodec.encode(terms)),
        stackHeight: 1,
      },
    ];
    f.meta.logMessages = [
      `Program ${program} invoke [1]`,
      log(eventCodec.encode(event)),
      `Program ${program} success`,
    ];
    return f;
  }
  it(`${label} handover validates without inventing artwork history, including a genuine CPI-shaped invocation`, () => {
    const f = fixture();
    expect(decodeFinalizedActivity(f, SIG, SLOT).activities).toEqual([]);
    const wrapper = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";
    f.transaction.message.accountKeys.push(wrapper);
    const inner = { ...f.transaction.message.instructions[0]!, stackHeight: 2 };
    f.transaction.message.instructions = [
      { programIdIndex: 6, accounts: [], data: base58([99]), stackHeight: 1 },
    ];
    f.meta.innerInstructions = [{ index: 0, instructions: [inner] }];
    f.meta.logMessages = [
      `Program ${wrapper} invoke [1]`,
      `Program ${program} invoke [2]`,
      log(eventCodec.encode(event)),
      `Program ${program} success`,
      `Program ${wrapper} success`,
    ];
    expect(decodeFinalizedActivity(f, SIG, SLOT).activities).toEqual([]);
  });
  it.each([
    { config: OWNER },
    { previousAuthority: OWNER },
    { authority: ARTWORK },
    { multisig: OWNER },
    { vaultIndex: 1 },
    { members: [OWNER, ARTWORK, SYSTEM] },
    { timeLock: 0 },
  ])(`${label} rejects substituted governance event %j`, (patch) => {
    const f = fixture();
    f.meta.logMessages[1] = log(eventCodec.encode({ ...event, ...patch }));
    expect(() => decodeFinalizedActivity(f, SIG, SLOT)).toThrow();
  });
  it(`${label} rejects missing, duplicate, wrong-discriminator and trailing event bytes`, () => {
    for (const lines of [
      [],
      [log(eventCodec.encode(event)), log(eventCodec.encode(event))],
      [log(new Uint8Array(eventCodec.encode(event).length))],
      [log([...eventCodec.encode(event), 0])],
    ]) {
      const f = fixture();
      f.meta.logMessages = [
        `Program ${program} invoke [1]`,
        ...lines,
        `Program ${program} success`,
      ];
      expect(() => decodeFinalizedActivity(f, SIG, SLOT)).toThrow();
    }
  });
}
