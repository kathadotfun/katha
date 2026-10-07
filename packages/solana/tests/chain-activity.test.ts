import { expect, it } from "vitest";
import { decodeFinalizedActivity } from "../src/chain-activity.js";
import { decodeRegistryEvent } from "../src/registry-events.js";
import { CORE_PROGRAM_ADDRESS } from "../src/core.js";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  getArtworkMintedEventEncoder,
  getArtworkVerifiedEventEncoder,
  getMintArtworkInstructionDataEncoder,
  getPlatformInitializedEventEncoder,
  getArtworkRegisteredEventEncoder,
  getMetadataCommittedEventEncoder,
  getInitializeMetadataInstructionDataEncoder,
  getReviseUnmintedMetadataInstructionDataEncoder,
  getReviseMintedMetadataInstructionDataEncoder,
  getConditionRecordedEventEncoder,
  getCustodyUpdatedEventEncoder,
  ArtworkCategory,
  ConditionGrade,
  ConditionReason,
  CustodyAction,
  CustodyState,
} from "../src/generated/registry/index.js";
import {
  activityFixture,
  SIG,
  SLOT,
  SYSTEM,
  ARTWORK,
  OWNER,
  COLLECTION,
  base58,
  eventBytes,
  eventLog,
} from "./fixtures/activity.js";
const decode = (f: unknown) => decodeFinalizedActivity(f, SIG, SLOT);
it.each(["legacy", 0, 1] as const)(
  "decodes exact Registry event from version %s",
  (version) => {
    const f = activityFixture();
    f.version = version;
    const result = decode(f);
    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]).toMatchObject({
      kind: "REGISTRY",
      outerInstructionIndex: 0,
      innerInstructionIndex: -1,
      eventIndex: 0,
      event: { name: "ArtworkVerified", value: { artwork: ARTWORK, verifiedAt: 1n } },
    });
  },
);
it("decodes a direct Core transfer without guessing the previous owner", () => {
  expect(decode(activityFixture(CORE_PROGRAM_ADDRESS)).activities[0]).toMatchObject({
    kind: "CORE_TRANSFER",
    transfer: {
      asset: ARTWORK,
      collection: COLLECTION,
      authority: SYSTEM,
      newOwner: OWNER,
    },
  });
});
it("decodes loaded address indexes in writable then readonly order", () => {
  const f = activityFixture(CORE_PROGRAM_ADDRESS);
  f.transaction.message.accountKeys = [
    KATHA_REGISTRY_PROGRAM_ADDRESS,
    CORE_PROGRAM_ADDRESS,
    SYSTEM,
    ARTWORK,
  ];
  f.transaction.message.addressTableLookups = [
    { accountKey: COLLECTION, writableIndexes: [0], readonlyIndexes: [1] },
  ];
  f.meta.loadedAddresses = { writable: [OWNER], readonly: [COLLECTION] };
  expect(decode(f).activities[0]).toMatchObject({
    transfer: { collection: COLLECTION, newOwner: OWNER },
  });
});
it("retains a Registry mint once while observing its non-transfer Core CPI", () => {
  const f = activityFixture();
  f.transaction.message.instructions[0]!.data = base58(
    getMintArtworkInstructionDataEncoder().encode({}),
  );
  f.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        {
          programIdIndex: 1,
          accounts: [3, 5, 2, 2, 4],
          data: base58([20]),
          stackHeight: 2,
        },
      ],
    },
  ];
  const minted = getArtworkMintedEventEncoder().encode({
    artwork: ARTWORK,
    kathaId: "KATHA-PAUBHA-000001",
    asset: OWNER,
    collection: COLLECTION,
    initialOwner: SYSTEM,
    metadataVersion: 1,
    metadataHash: new Uint8Array(32),
    conditionReport: COLLECTION,
    custodyRevision: 1n,
    mintedBy: SYSTEM,
    mintedAt: 1n,
  });
  f.meta.logMessages = [
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} invoke [1]`,
    `Program ${CORE_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${CORE_PROGRAM_ADDRESS} success`,
    `Program data: ${Buffer.from(minted).toString("base64")}`,
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} success`,
  ];
  expect(decode(f).activities.map((a) => a.kind)).toEqual(["REGISTRY"]);
});
it("attributes Core CPI transfer to its exact outer/inner position", () => {
  const f = activityFixture();
  f.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        {
          programIdIndex: 1,
          accounts: [3, 5, 2, 2, 4],
          data: base58([14, 0]),
          stackHeight: 2,
        },
      ],
    },
  ];
  f.meta.logMessages.splice(
    1,
    0,
    `Program ${CORE_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${CORE_PROGRAM_ADDRESS} success`,
  );
  expect(
    decode(f).activities.map((a) => [
      a.kind,
      a.outerInstructionIndex,
      a.innerInstructionIndex,
    ]),
  ).toEqual([
    ["CORE_TRANSFER", 0, 0],
    ["REGISTRY", 0, -1],
  ]);
});
it("discards a caught failed Core CPI while retaining the successful outer event", () => {
  const f = activityFixture();
  f.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        {
          programIdIndex: 1,
          accounts: [3, 5, 2, 2, 4],
          data: base58([14, 0]),
          stackHeight: 2,
        },
      ],
    },
  ];
  f.meta.logMessages.splice(
    1,
    0,
    `Program ${CORE_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${CORE_PROGRAM_ADDRESS} failed: synthetic error`,
  );
  expect(decode(f).activities.map((a) => a.kind)).toEqual(["REGISTRY"]);
});
it("never decodes logs or instructions from a failed transaction", () => {
  const f = activityFixture();
  f.meta.err = { InstructionError: [0, "Synthetic"] };
  f.meta.logMessages = ["invalid and incomplete logs"];
  expect(decode(f)).toMatchObject({
    outcome: "FAILED",
    chainRecordedAt: null,
    activities: [],
  });
});
it("ignores forged Registry data emitted by another program", () => {
  const f = activityFixture(CORE_PROGRAM_ADDRESS);
  f.meta.logMessages.splice(
    1,
    0,
    eventLog(),
    `Program log: Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} invoke [1]`,
  );
  expect(decode(f).activities.map((a) => a.kind)).toEqual(["CORE_TRANSFER"]);
});
it("accepts unlogged Ed25519 precompile while preserving outer position", () => {
  const f = activityFixture();
  f.transaction.message.accountKeys.push("Ed25519SigVerify111111111111111111111111111");
  f.transaction.message.instructions.unshift({
    programIdIndex: 6,
    accounts: [],
    data: "",
    stackHeight: null,
  });
  expect(decode(f).activities[0]?.outerInstructionIndex).toBe(1);
});
it.each([
  "missing transaction",
  "wrong signature",
  "wrong slot",
  "future timestamp",
  "missing timestamp",
  "wrong version",
  "missing metadata",
  "missing result",
  "invalid error",
  "missing inner instructions",
  "missing logs",
  "truncated logs",
  "unbalanced logs",
  "wrong invocation",
  "wrong stack height",
  "missing event",
  "extra event",
  "wrong event artwork",
  "unknown event",
  "invalid base64",
  "bad account index",
  "missing loaded keys",
  "duplicate inner group",
  "unconsumed CPI",
  "outer failure",
])("blocks incomplete or forged %s", (reason) => {
  const f = activityFixture();
  const raw = f as unknown as Record<string, unknown>;
  switch (reason) {
    case "missing transaction":
      raw.transaction = null;
      break;
    case "wrong signature":
      f.transaction.signatures[0] = "1".repeat(64);
      break;
    case "wrong slot":
      f.slot++;
      break;
    case "future timestamp":
      f.blockTime = BigInt(Math.floor(Date.now() / 1000) + 100);
      break;
    case "missing timestamp":
      raw.blockTime = null;
      break;
    case "wrong version":
      f.version = 2;
      break;
    case "missing metadata":
      raw.meta = null;
      break;
    case "missing result":
      f.meta.err = undefined;
      break;
    case "invalid error":
      f.meta.err = true;
      break;
    case "missing inner instructions":
      (f.meta as unknown as Record<string, unknown>).innerInstructions = null;
      break;
    case "missing logs":
      (f.meta as unknown as Record<string, unknown>).logMessages = null;
      break;
    case "truncated logs":
      f.meta.logMessages.push("Log truncated");
      break;
    case "unbalanced logs":
      f.meta.logMessages.pop();
      break;
    case "wrong invocation":
      f.meta.logMessages[0] = `Program ${CORE_PROGRAM_ADDRESS} invoke [1]`;
      break;
    case "wrong stack height":
      f.transaction.message.instructions[0]!.stackHeight = 2;
      break;
    case "missing event":
      f.meta.logMessages.splice(1, 1);
      break;
    case "extra event":
      f.meta.logMessages.splice(1, 0, eventLog());
      break;
    case "wrong event artwork":
      f.transaction.message.instructions[0]!.accounts = [2, 4, 5, 2, 2];
      break;
    case "unknown event":
      f.meta.logMessages[1] = `Program data: ${Buffer.from(new Uint8Array(8)).toString("base64")}`;
      break;
    case "invalid base64":
      f.meta.logMessages[1] = "Program data: ####";
      break;
    case "bad account index":
      f.transaction.message.instructions[0]!.accounts = [1000];
      break;
    case "missing loaded keys":
      f.transaction.message.addressTableLookups = [{}];
      (f.meta as unknown as Record<string, unknown>).loadedAddresses = undefined;
      break;
    case "duplicate inner group":
      f.meta.innerInstructions = [
        { index: 0, instructions: [] },
        { index: 0, instructions: [] },
      ];
      break;
    case "unconsumed CPI":
      f.meta.innerInstructions = [
        {
          index: 0,
          instructions: [{ programIdIndex: 1, accounts: [], data: "", stackHeight: 2 }],
        },
      ];
      break;
    case "outer failure":
      f.meta.logMessages[2] = `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} failed: synthetic`;
      break;
  }
  expect(() => decode(f)).toThrow("Incomplete or invalid");
});
it("rejects trailing event bytes and invalid permanent identity", () => {
  expect(() => decodeRegistryEvent(Uint8Array.from([...eventBytes(), 0]))).toThrow();
  const bad = getArtworkVerifiedEventEncoder().encode({
    artwork: ARTWORK,
    kathaId: "KATHA-PAUBHA-000000",
    authorshipEvidenceHash: new Uint8Array(32),
    verifier: SYSTEM,
    verifiedAt: 1n,
  });
  expect(() => decodeRegistryEvent(Uint8Array.from(bad))).toThrow();
});
it("decodes every other generated Registry event family", () => {
  const hash = new Uint8Array(32),
    common = { artwork: ARTWORK, kathaId: "KATHA-PAUBHA-000001" };
  const events = [
    [
      "PlatformInitialized",
      getPlatformInitializedEventEncoder().encode({
        config: ARTWORK,
        authority: SYSTEM,
        collection: COLLECTION,
        registrationAuthority: SYSTEM,
        verifierAuthority: SYSTEM,
        custodyAuthority: SYSTEM,
        treasury: SYSTEM,
      }),
    ],
    [
      "ArtworkRegistered",
      getArtworkRegisteredEventEncoder().encode({
        ...common,
        artistId: "11111111-1111-4111-8111-111111111111",
        creatorWallet: null,
        category: ArtworkCategory.Paubha,
        creationYear: 2026,
        authorshipEvidenceHash: hash,
        collection: COLLECTION,
        registeredBy: SYSTEM,
        registeredAt: 1n,
      }),
    ],
    [
      "MetadataCommitted",
      getMetadataCommittedEventEncoder().encode({
        ...common,
        revision: COLLECTION,
        version: 1,
        documentHash: hash,
        committedBy: SYSTEM,
        committedAt: 1n,
      }),
    ],
    [
      "ConditionRecorded",
      getConditionRecordedEventEncoder().encode({
        ...common,
        report: COLLECTION,
        reportId: new Uint8Array(16),
        version: 1,
        reportHash: hash,
        grade: ConditionGrade.Excellent,
        reason: ConditionReason.InitialVerification,
        inspectorId: new Uint8Array(16),
        verifier: SYSTEM,
        inspectedAt: 1n,
        recordedAt: 1n,
        ownerScope: null,
        custodyRevisionScope: null,
      }),
    ],
    [
      "CustodyUpdated",
      getCustodyUpdatedEventEncoder().encode({
        ...common,
        transition: COLLECTION,
        revision: 1n,
        action: CustodyAction.AttestKathaCustody,
        fromState: CustodyState.Unknown,
        toState: CustodyState.KathaHeld,
        fromSubject: null,
        toSubject: null,
        attestedBy: SYSTEM,
        recordedAt: 1n,
      }),
    ],
  ] as const;
  for (const [name, data] of events)
    expect(decodeRegistryEvent(Uint8Array.from(data)).name).toBe(name);
});
it("attributes a Registry event inside another program's CPI", () => {
  const f = activityFixture();
  const inner = { ...f.transaction.message.instructions[0]!, stackHeight: 2 };
  f.transaction.message.instructions[0] = {
    programIdIndex: 2,
    accounts: [],
    data: "",
    stackHeight: 1,
  };
  f.meta.innerInstructions = [{ index: 0, instructions: [inner] }];
  f.meta.logMessages = [
    `Program ${SYSTEM} invoke [1]`,
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} invoke [2]`,
    eventLog(),
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} success`,
    `Program ${SYSTEM} success`,
  ];
  expect(decode(f).activities[0]).toMatchObject({
    kind: "REGISTRY",
    outerInstructionIndex: 0,
    innerInstructionIndex: 0,
  });
});
it("discards successful descendant transfer when its parent CPI later fails", () => {
  const f = activityFixture();
  const inner = { ...f.transaction.message.instructions[0]!, stackHeight: 2 };
  f.meta.innerInstructions = [
    {
      index: 0,
      instructions: [
        inner,
        {
          programIdIndex: 1,
          accounts: [3, 5, 2, 2, 4],
          data: base58([14, 0]),
          stackHeight: 3,
        },
      ],
    },
  ];
  f.meta.logMessages = [
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} invoke [1]`,
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${CORE_PROGRAM_ADDRESS} invoke [3]`,
    `Program ${CORE_PROGRAM_ADDRESS} success`,
    eventLog(),
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} failed: synthetic`,
    eventLog(),
    `Program ${KATHA_REGISTRY_PROGRAM_ADDRESS} success`,
  ];
  expect(decode(f).activities.map((a) => [a.kind, a.innerInstructionIndex])).toEqual([
    ["REGISTRY", -1],
  ]);
});
it.each(["trailing bytes", "compressed transfer", "missing asset", "missing owner"])(
  "rejects unsupported Core transfer: %s",
  (reason) => {
    const f = activityFixture(CORE_PROGRAM_ADDRESS);
    switch (reason) {
      case "trailing bytes":
        f.transaction.message.instructions[0]!.data = base58([14, 0, 0]);
        break;
      case "compressed transfer":
        f.transaction.message.instructions[0]!.data = base58([14, 1]);
        break;
      case "missing asset":
        f.transaction.message.instructions[0]!.accounts[0] = 1;
        break;
      case "missing owner":
        f.transaction.message.instructions[0]!.accounts = [3, 5, 2, 2];
        break;
    }
    expect(() => decode(f)).toThrow();
  },
);

it.each([
  "loaded count mismatch",
  "unexpected legacy lookup",
  "duplicate lookup index",
])("rejects %s", (reason) => {
  const f = activityFixture();
  if (reason === "loaded count mismatch") f.meta.loadedAddresses.readonly = [OWNER];
  else {
    f.transaction.message.addressTableLookups = [
      {
        accountKey: COLLECTION,
        writableIndexes: [0],
        readonlyIndexes: reason === "duplicate lookup index" ? [0] : [],
      },
    ];
    f.meta.loadedAddresses.writable = [OWNER];
    if (reason === "unexpected legacy lookup") f.version = "legacy";
  }
  expect(() => decode(f)).toThrow();
});

it.each(["INITIALIZE", "UNMINTED", "MINTED"] as const)(
  "extracts the exact signed metadata URI for %s and rejects hash/trailing-byte mismatches",
  (mode) => {
    const hash = new Uint8Array(32).fill(7),
      uri = "https://example.com/synthetic.json";
    const args = { documentHash: hash, uri, expectedVersion: 1, nextVersion: 2 };
    const bytes =
      mode === "INITIALIZE"
        ? getInitializeMetadataInstructionDataEncoder().encode(args)
        : mode === "UNMINTED"
          ? getReviseUnmintedMetadataInstructionDataEncoder().encode(args)
          : getReviseMintedMetadataInstructionDataEncoder().encode(args);
    const fixture = () => {
      const f = activityFixture();
      f.transaction.message.instructions[0]!.data = base58(bytes);
      f.meta.logMessages[1] = `Program data: ${Buffer.from(getMetadataCommittedEventEncoder().encode({ artwork: ARTWORK, kathaId: "KATHA-PAUBHA-000001", revision: COLLECTION, version: mode === "INITIALIZE" ? 1 : 2, documentHash: hash, committedBy: SYSTEM, committedAt: 1n })).toString("base64")}`;
      return f;
    };
    expect(decode(fixture()).activities[0]).toMatchObject({
      metadataUri: uri,
      event: { name: "MetadataCommitted" },
    });
    const trailing = fixture();
    trailing.transaction.message.instructions[0]!.data = base58([...bytes, 0]);
    expect(() => decode(trailing)).toThrow("Incomplete or invalid");
    const mismatch = fixture();
    mismatch.transaction.message.instructions[0]!.data = base58(
      mode === "INITIALIZE"
        ? getInitializeMetadataInstructionDataEncoder().encode({
            ...args,
            documentHash: new Uint8Array(32),
          })
        : mode === "UNMINTED"
          ? getReviseUnmintedMetadataInstructionDataEncoder().encode({
              ...args,
              documentHash: new Uint8Array(32),
            })
          : getReviseMintedMetadataInstructionDataEncoder().encode({
              ...args,
              documentHash: new Uint8Array(32),
            }),
    );
    expect(() => decode(mismatch)).toThrow("Incomplete or invalid");
  },
);
