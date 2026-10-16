import { address, getBase58Encoder, signature, type Address } from "@solana/kit";
import {
  CORE_PROGRAM_ADDRESS,
  decodeCoreTransferInstruction,
  type CoreTransferActivity,
} from "./core.js";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  identifyKathaRegistryInstruction,
  KathaRegistryInstruction,
  getInitializeMetadataInstructionDataCodec,
  getReviseUnmintedMetadataInstructionDataCodec,
  getReviseMintedMetadataInstructionDataCodec,
} from "./generated/registry/index.js";
import { decodeRegistryEvent, type RegistryActivityEvent } from "./registry-events.js";

import * as marketplace from "./generated/marketplace/index.js";
import {
  decodeMarketplaceEvent,
  type MarketplaceActivityEvent,
} from "./marketplace-events.js";

const marketplaceEventNames: Partial<
  Record<marketplace.KathaMarketplaceInstruction, MarketplaceActivityEvent["name"]>
> = {
  [marketplace.KathaMarketplaceInstruction.InitializeMarketplace]:
    "MarketplaceInitialized",
  [marketplace.KathaMarketplaceInstruction.CreateListing]: "ListingCreated",
  [marketplace.KathaMarketplaceInstruction.CreateListingWithFees]: "ListingCreated",
  [marketplace.KathaMarketplaceInstruction.InitializeFeeSchedule]: "FeeScheduleChanged",
  [marketplace.KathaMarketplaceInstruction.UpdateFeeSchedule]: "FeeScheduleChanged",
  [marketplace.KathaMarketplaceInstruction.CancelListing]: "ListingReleased",
  [marketplace.KathaMarketplaceInstruction.ExpireListing]: "ListingReleased",
  [marketplace.KathaMarketplaceInstruction.PurchaseListing]: "ArtworkPurchased",
};
function readInstruction<A, T extends A>(
  codec: { decode(data: Uint8Array): T; encode(value: A): ArrayLike<number> },
  data: Uint8Array,
): T {
  const value = codec.decode(data);
  if (!Buffer.from(codec.encode(value)).equals(data)) fail();
  return value;
}
const registryEventNames: Record<
  KathaRegistryInstruction,
  RegistryActivityEvent["name"]
> = {
  [KathaRegistryInstruction.InitializePlatform]: "PlatformInitialized",
  [KathaRegistryInstruction.RegisterArtwork]: "ArtworkRegistered",
  [KathaRegistryInstruction.VerifyArtwork]: "ArtworkVerified",
  [KathaRegistryInstruction.InitializeMetadata]: "MetadataCommitted",
  [KathaRegistryInstruction.ReviseUnmintedMetadata]: "MetadataCommitted",
  [KathaRegistryInstruction.ReviseMintedMetadata]: "MetadataCommitted",
  [KathaRegistryInstruction.InitializeCondition]: "ConditionRecorded",
  [KathaRegistryInstruction.RecordUnmintedCondition]: "ConditionRecorded",
  [KathaRegistryInstruction.RecordMintedCondition]: "ConditionRecorded",
  [KathaRegistryInstruction.InitializeCustody]: "CustodyUpdated",
  [KathaRegistryInstruction.TransitionCustody]: "CustodyUpdated",
  [KathaRegistryInstruction.MintArtwork]: "ArtworkMinted",
};
// Agave precompiles do not emit invoke/success logs. Never skip an arbitrary program.
const unloggedPrograms = new Set([
  "Ed25519SigVerify111111111111111111111111111",
  "KeccakSecp256k11111111111111111111111111111",
  "Secp256r1SigVerify1111111111111111111111111",
]);
export class ActivityEvidenceError extends Error {
  constructor() {
    super("Incomplete or invalid finalized activity evidence");
  }
}
function fail(): never {
  throw new ActivityEvidenceError();
}
export function activityRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export function activityArray(value: unknown, maximum = 10000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail();
  return value;
}
function index(value: unknown, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= maximum
  )
    fail();
  return value;
}
export function activitySlot(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n || value > 0x7fff_ffff_ffff_ffffn) fail();
  return value;
}
function chainTime(value: unknown): Date {
  if (typeof value !== "bigint" || value < 0n || value > 8640000000000n) fail();
  const result = new Date(Number(value) * 1000);
  if (!Number.isFinite(result.getTime()) || result.getTime() > Date.now()) fail();
  return result;
}
interface Position {
  outerInstructionIndex: number;
  innerInstructionIndex: number;
  eventIndex: number;
}
export type DecodedActivity = Position &
  (
    | {
        programAddress: Address;
        kind: "REGISTRY";
        event: RegistryActivityEvent;
        metadataUri?: string;
      }
    | {
        programAddress: Address;
        kind: "MARKETPLACE";
        event: MarketplaceActivityEvent;
        collection: Address;
      }
    | { programAddress: Address; kind: "CORE_TRANSFER"; transfer: CoreTransferActivity }
  );
export interface ActivityTransaction {
  signature: string;
  slot: bigint;
  chainRecordedAt: Date | null;
  outcome: "SUCCESS" | "FAILED";
  activities: DecodedActivity[];
}
interface Invocation {
  program: Address;
  accounts: Address[];
  data: Uint8Array;
  outer: number;
  inner: number;
  height: number | null;
}

/** Input is the raw Kit JSON response, not jsonParsed instructions or client assertions. */
export function decodeFinalizedActivity(
  input: unknown,
  expectedSignature: string,
  expectedSlot: bigint,
): ActivityTransaction {
  try {
    signature(expectedSignature);
    activitySlot(expectedSlot);
    const response = activityRecord(input);
    if (
      activitySlot(response.slot) !== expectedSlot ||
      !["legacy", 0, 1].includes(response.version as string | number)
    )
      fail();
    const transaction = activityRecord(response.transaction);
    const signatures = activityArray(transaction.signatures, 64);
    if (signatures[0] !== expectedSignature) fail();
    for (const item of signatures) {
      if (typeof item !== "string") fail();
      signature(item);
    }
    const meta = activityRecord(response.meta);
    if (meta.err === undefined) fail();
    if (meta.err !== null) {
      if (typeof meta.err !== "object" && typeof meta.err !== "string") fail();
      // Failed transactions have no successful state changes, irrespective of log content.
      return {
        signature: expectedSignature,
        slot: expectedSlot,
        chainRecordedAt: null,
        outcome: "FAILED",
        activities: [],
      };
    }
    const recordedAt = chainTime(response.blockTime);
    const message = activityRecord(transaction.message);
    const keys = activityArray(message.accountKeys, 256).map((key) =>
      typeof key === "string" ? address(key) : fail(),
    );
    const lookups =
      message.addressTableLookups === undefined
        ? []
        : activityArray(message.addressTableLookups, 64);
    let writableCount = 0,
      readonlyCount = 0;
    for (const value of lookups) {
      const lookup = activityRecord(value);
      if (typeof lookup.accountKey !== "string") fail();
      address(lookup.accountKey);
      const writable = activityArray(lookup.writableIndexes, 256).map((v) =>
        index(v, 256),
      );
      const readonly = activityArray(lookup.readonlyIndexes, 256).map((v) =>
        index(v, 256),
      );
      if (
        new Set([...writable, ...readonly]).size !==
        writable.length + readonly.length
      )
        fail();
      writableCount += writable.length;
      readonlyCount += readonly.length;
    }
    if (response.version === "legacy" && lookups.length !== 0) fail();
    if (lookups.length > 0 && meta.loadedAddresses === undefined) fail();
    const loaded = activityRecord(
      meta.loadedAddresses ?? { writable: [], readonly: [] },
    );
    const writableKeys = activityArray(loaded.writable, 256),
      readonlyKeys = activityArray(loaded.readonly, 256);
    if (writableKeys.length !== writableCount || readonlyKeys.length !== readonlyCount)
      fail();
    for (const key of [...writableKeys, ...readonlyKeys])
      keys.push(typeof key === "string" ? address(key) : fail());
    if (keys.length > 256 || keys.length === 0 || new Set(keys).size !== keys.length)
      fail();
    const outer = activityArray(message.instructions, 256);
    function instruction(value: unknown, o: number, i: number): Invocation {
      const record = activityRecord(value);
      const program = keys[index(record.programIdIndex, keys.length)]!;
      const accounts = activityArray(record.accounts, 256).map(
        (n) => keys[index(n, keys.length)]!,
      );
      if (typeof record.data !== "string" || record.data.length > 12000) fail();
      const data = Uint8Array.from(getBase58Encoder().encode(record.data));
      const height = record.stackHeight == null ? null : index(record.stackHeight, 65);
      return { program, accounts, data, outer: o, inner: i, height };
    }
    const outers = outer.map((value, o) => instruction(value, o, -1));
    if (meta.innerInstructions == null || meta.logMessages == null) fail();
    const inners = new Map<number, Invocation[]>();
    for (const value of activityArray(meta.innerInstructions, 256)) {
      const group = activityRecord(value),
        o = index(group.index, outer.length);
      if (inners.has(o)) fail();
      inners.set(
        o,
        activityArray(group.instructions).map((v, i) => instruction(v, o, i)),
      );
    }
    const logs = activityArray(meta.logMessages);
    let size = 0,
      outerCursor = -1;
    const innerCursors = new Map<number, number>();
    const stack: {
      invocation: Invocation;
      activities: DecodedActivity[];
      eventCount: number;
    }[] = [];
    const activities: DecodedActivity[] = [];
    for (const line of logs) {
      if (
        typeof line !== "string" ||
        (size += line.length) > 1024 * 1024 ||
        line === "Log truncated"
      )
        fail();
      const invoke =
        /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[([1-9][0-9]*)\]$/.exec(line);
      if (invoke) {
        const depth = Number(invoke[2]);
        if (depth !== stack.length + 1) fail();
        let invocation: Invocation | undefined;
        if (depth === 1) {
          do {
            invocation = outers[++outerCursor];
          } while (
            invocation &&
            unloggedPrograms.has(invocation.program) &&
            invocation.program !== invoke[1]
          );
        } else {
          const cursor = innerCursors.get(outerCursor) ?? 0;
          invocation = inners.get(outerCursor)?.[cursor];
          innerCursors.set(outerCursor, cursor + 1);
        }
        if (
          !invocation ||
          invocation.program !== invoke[1] ||
          (invocation.height !== null && invocation.height !== depth)
        )
          fail();
        const frame = {
          invocation,
          activities: [] as DecodedActivity[],
          eventCount: 0,
        };
        stack.push(frame);
        continue;
      }
      const completed =
        /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed: .*)$/.exec(line);
      if (completed) {
        const frame = stack.pop();
        if (!frame || frame.invocation.program !== completed[1]) fail();
        if (completed[2] === "success") {
          const invocation = frame.invocation;
          if (
            invocation.program === KATHA_REGISTRY_PROGRAM_ADDRESS &&
            frame.eventCount !== 1
          )
            fail();
          if (invocation.program === marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS) {
            const expected =
              marketplaceEventNames[
                marketplace.identifyKathaMarketplaceInstruction(invocation.data)
              ];
            if (frame.eventCount !== (expected ? 1 : 0)) fail();
            const purchase = frame.activities.find(
              (a) => a.kind === "MARKETPLACE" && a.event.name === "ArtworkPurchased",
            );
            if (
              purchase?.kind === "MARKETPLACE" &&
              purchase.event.name === "ArtworkPurchased"
            ) {
              const value = purchase.event.value;
              const transfers = frame.activities.filter(
                (a) => a.kind === "CORE_TRANSFER",
              );
              const transfer = transfers[0];
              if (
                transfers.length !== 1 ||
                transfer?.kind !== "CORE_TRANSFER" ||
                transfer.transfer.asset !== value.asset ||
                transfer.transfer.newOwner !== value.buyer ||
                transfer.transfer.authority !== value.listing ||
                transfer.transfer.collection !== invocation.accounts[12]
              )
                fail();
            }
          }
          if (invocation.program === CORE_PROGRAM_ADDRESS) {
            const transfer = decodeCoreTransferInstruction(
              invocation.data,
              invocation.accounts,
            );
            if (transfer)
              frame.activities.push({
                programAddress: CORE_PROGRAM_ADDRESS,
                kind: "CORE_TRANSFER",
                transfer,
                outerInstructionIndex: invocation.outer,
                innerInstructionIndex: invocation.inner,
                eventIndex: 0,
              });
          }
          (stack.at(-1)?.activities ?? activities).push(...frame.activities);
        } else if (frame.invocation.inner === -1) fail();
        continue;
      }
      if (
        line.startsWith("Program data: ") &&
        stack.at(-1)?.invocation.program ===
          marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS
      ) {
        const encoded = line.slice(14),
          data = Buffer.from(encoded, "base64");
        if (data.toString("base64") !== encoded) fail();
        const frame = stack.at(-1)!,
          event = decodeMarketplaceEvent(data);
        const kind = marketplace.identifyKathaMarketplaceInstruction(
          frame.invocation.data,
        );
        if (event.name !== marketplaceEventNames[kind]) fail();
        const accounts = frame.invocation.accounts;
        if (event.name === "FeeScheduleChanged") {
          const value =
            kind === marketplace.KathaMarketplaceInstruction.InitializeFeeSchedule
              ? {
                  ...readInstruction(
                    marketplace.getInitializeFeeScheduleInstructionDataCodec(),
                    frame.invocation.data,
                  ),
                  expectedRevision: 0n,
                }
              : readInstruction(
                  marketplace.getUpdateFeeScheduleInstructionDataCodec(),
                  frame.invocation.data,
                );
          if (
            event.value.config !== accounts[0] ||
            event.value.schedule !== accounts[1] ||
            event.value.authority !== accounts[2] ||
            value.primaryCommissionBps !== event.value.primaryCommissionBps ||
            value.secondaryCommissionBps !== event.value.secondaryCommissionBps ||
            value.secondaryRoyaltyBps !== event.value.secondaryRoyaltyBps ||
            event.value.revision !== value.expectedRevision + 1n
          )
            fail();
        } else if (event.name === "MarketplaceInitialized") {
          const codec = marketplace.getInitializeMarketplaceInstructionDataCodec(),
            value = codec.decode(frame.invocation.data);
          if (
            !Buffer.from(codec.encode(value)).equals(frame.invocation.data) ||
            value.commissionBps !== event.value.commissionBps ||
            value.secondaryRoyaltyBps !== event.value.secondaryRoyaltyBps ||
            value.inspectionValiditySeconds !== event.value.inspectionValiditySeconds ||
            event.value.authority !== accounts[6] ||
            event.value.paymentMint !== accounts[7] ||
            event.value.tokenProgram !== accounts[8]
          )
            fail();
          if (
            event.value.config !== accounts[0] ||
            event.value.registryProgram !== accounts[4] ||
            event.value.registryConfig !== accounts[5]
          )
            fail();
        } else {
          const released = event.name === "ListingReleased";
          if (
            event.value.artwork !== accounts[3] ||
            event.value.asset !== accounts[released ? 4 : 9] ||
            event.value.listing !== accounts[released ? 5 : 11]
          )
            fail();
          if (event.name === "ListingCreated") {
            const value =
              kind === marketplace.KathaMarketplaceInstruction.CreateListingWithFees
                ? readInstruction(
                    marketplace.getCreateListingWithFeesInstructionDataCodec(),
                    frame.invocation.data,
                  )
                : readInstruction(
                    marketplace.getCreateListingInstructionDataCodec(),
                    frame.invocation.data,
                  );
            if (
              value.expectedRevision + 1n !== event.value.revision ||
              value.price !== event.value.price ||
              value.expiresAt !== event.value.expiresAt ||
              event.value.seller !== accounts[10]
            )
              fail();
          }
          if (event.name === "ListingReleased") {
            const codec =
              kind === marketplace.KathaMarketplaceInstruction.CancelListing
                ? marketplace.getCancelListingInstructionDataCodec()
                : marketplace.getExpireListingInstructionDataCodec();
            const value = codec.decode(frame.invocation.data);
            if (
              !Buffer.from(codec.encode(value)).equals(frame.invocation.data) ||
              value.expectedRevision + 1n !== event.value.revision ||
              event.value.actor !== accounts[6] ||
              event.value.status !==
                (kind === marketplace.KathaMarketplaceInstruction.CancelListing
                  ? marketplace.ListingStatus.Cancelled
                  : marketplace.ListingStatus.Expired)
            )
              fail();
          }
          if (event.name === "ArtworkPurchased") {
            const codec = marketplace.getPurchaseListingInstructionDataCodec(),
              value = codec.decode(frame.invocation.data);
            if (
              !Buffer.from(codec.encode(value)).equals(frame.invocation.data) ||
              value.expectedPrice !== event.value.price ||
              value.expectedRevision + 1n !== event.value.revision ||
              event.value.buyer !== accounts[14] ||
              event.value.seller !== accounts[10] ||
              event.value.paymentMint !== accounts[15]
            )
              fail();
          }
        }
        frame.activities.push({
          programAddress: marketplace.KATHA_MARKETPLACE_PROGRAM_ADDRESS,
          kind: "MARKETPLACE",
          collection:
            event.name === "MarketplaceInitialized" ||
            event.name === "FeeScheduleChanged"
              ? event.value.collection
              : accounts[event.name === "ListingReleased" ? 7 : 12]!,
          event,
          outerInstructionIndex: frame.invocation.outer,
          innerInstructionIndex: frame.invocation.inner,
          eventIndex: frame.eventCount++,
        });
      }
      if (
        line.startsWith("Program data: ") &&
        stack.at(-1)?.invocation.program === KATHA_REGISTRY_PROGRAM_ADDRESS
      ) {
        const encoded = line.slice(14),
          data = Buffer.from(encoded, "base64");
        if (data.toString("base64") !== encoded) fail();
        const frame = stack.at(-1)!;
        const event = decodeRegistryEvent(data);
        if (
          event.name !==
            registryEventNames[
              identifyKathaRegistryInstruction(frame.invocation.data)
            ] ||
          ("artwork" in event.value &&
            !frame.invocation.accounts.includes(event.value.artwork))
        )
          fail();
        let metadataUri: string | undefined;
        if (event.name === "MetadataCommitted") {
          const kind = identifyKathaRegistryInstruction(frame.invocation.data);
          const read = <T>(codec: {
            decode(data: Uint8Array): T;
            encode(data: T): ArrayLike<number>;
          }) => {
            const value = codec.decode(frame.invocation.data);
            if (!Buffer.from(codec.encode(value)).equals(frame.invocation.data)) fail();
            return value;
          };
          const instruction =
            kind === KathaRegistryInstruction.InitializeMetadata
              ? read(getInitializeMetadataInstructionDataCodec())
              : kind === KathaRegistryInstruction.ReviseUnmintedMetadata
                ? read(getReviseUnmintedMetadataInstructionDataCodec())
                : read(getReviseMintedMetadataInstructionDataCodec());
          if (
            !Buffer.from(instruction.documentHash).equals(
              Buffer.from(event.value.documentHash),
            )
          )
            fail();
          metadataUri = instruction.uri;
        }
        frame.activities.push({
          ...(metadataUri === undefined ? {} : { metadataUri }),
          programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
          kind: "REGISTRY",
          event,
          outerInstructionIndex: frame.invocation.outer,
          innerInstructionIndex: frame.invocation.inner,
          eventIndex: frame.eventCount++,
        });
      }
    }
    while (
      outers[outerCursor + 1] &&
      unloggedPrograms.has(outers[outerCursor + 1]!.program)
    )
      outerCursor++;
    if (stack.length !== 0 || outerCursor !== outers.length - 1) fail();
    for (const [o, group] of inners)
      if ((innerCursors.get(o) ?? 0) !== group.length) fail();
    return {
      signature: expectedSignature,
      slot: expectedSlot,
      chainRecordedAt: recordedAt,
      outcome: "SUCCESS",
      activities,
    };
  } catch {
    throw new ActivityEvidenceError();
  }
}
