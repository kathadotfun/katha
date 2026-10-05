import { describe, expect, it, vi } from "vitest";
import type { ActivityStore } from "@katha/db";
import {
  CORE_PROGRAM_ADDRESS,
  decodeRegistryEvent,
  type ActivityPage,
  type ActivityReader,
  type RegistryActivityEvent,
} from "@katha/solana";
import {
  findArtworkPda,
  findAssetPda,
  findConfigPda,
  findReportPda,
  findReviseMintedMetadataRevisionPda,
  findTransitionCustodyTransitionPda,
  getArtworkVerifiedEventEncoder,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
} from "@katha/solana/registry";
import {
  ingestActivityStream,
  prepareActivityEvents,
} from "../src/activity-ingestion.js";
const stream = {
  cluster: "LOCALNET" as const,
  programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
  fromSlot: 10n,
};
const collection = CORE_PROGRAM_ADDRESS;
const sig = (n: number) => String(n).repeat(64);
function transaction(
  n: number,
  slot: bigint,
  transactionIndex: number,
): ActivityPage["transactions"][number] {
  return {
    signature: sig(n),
    slot,
    transactionIndex,
    outcome: "SUCCESS",
    chainRecordedAt: new Date(1000),
    activities: [],
  };
}
const page = (transactions: ActivityPage["transactions"]): ActivityPage => ({
  cluster: "localnet",
  programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
  headSignature: transactions.at(-1)?.signature ?? null,
  nextBefore: null,
  transactions,
});
function setup(
  value: ActivityPage,
  cursor: Awaited<ReturnType<ActivityStore["cursor"]>> = null,
) {
  const store = {
    cursor: vi.fn().mockResolvedValue(cursor),
    commit: vi.fn().mockResolvedValue({ inserted: 0, replay: false }),
  } satisfies ActivityStore;
  const read: ActivityReader = vi.fn().mockResolvedValue(value);
  return { store, read, stream, collection };
}
describe("durable activity windows", () => {
  it("includes and verifies a start boundary before acknowledging the head", async () => {
    const options = setup(page([transaction(1, 9n, 0), transaction(2, 10n, 1)]));
    await ingestActivityStream(options);
    expect(options.store.commit).toHaveBeenCalledWith({
      ...stream,
      expected: null,
      head: { signature: sig(2), slot: 10n },
      events: [],
    });
    expect(options.read).toHaveBeenCalledWith(
      { programAddress: stream.programAddress, limit: 100 },
      undefined,
    );
  });
  it("uses the saved signature, including its slot, for same-slot restart", async () => {
    const expected = { signature: sig(2), slot: 10n };
    const options = setup(
      page([transaction(2, 10n, 1), transaction(3, 10n, 2)]),
      expected,
    );
    await ingestActivityStream(options);
    expect(options.store.commit).toHaveBeenCalledWith({
      ...stream,
      expected,
      head: { signature: sig(3), slot: 10n },
      events: [],
    });
  });
  it.each([page([]), page([transaction(2, 10n, 1)]), page([transaction(2, 11n, 1)])])(
    "does not acknowledge a missing start boundary",
    async (value) => {
      const options = setup(value);
      await expect(ingestActivityStream(options)).rejects.toThrow("boundary");
      expect(options.store.commit).not.toHaveBeenCalled();
    },
  );
  it("does not infer saved-boundary retention from a short page", async () => {
    const options = setup(page([transaction(3, 11n, 1)]), {
      signature: sig(2),
      slot: 10n,
    });
    await expect(ingestActivityStream(options)).rejects.toThrow("checkpoint");
    expect(options.store.commit).not.toHaveBeenCalled();
  });
  it("rejects a saved signature at a different slot", async () => {
    const options = setup(page([transaction(2, 11n, 1)]), {
      signature: sig(2),
      slot: 10n,
    });
    await expect(ingestActivityStream(options)).rejects.toThrow("checkpoint");
  });
  it("stops on read/commit failures and permits retry from the same cursor", async () => {
    const options = setup(page([transaction(1, 9n, 0), transaction(2, 10n, 1)]));
    options.store.commit.mockRejectedValueOnce(new Error("crash"));
    await expect(ingestActivityStream(options)).rejects.toThrow("crash");
    await ingestActivityStream(options);
    expect(options.store.commit.mock.calls[0]).toEqual(
      options.store.commit.mock.calls[1],
    );
  });
  it("rejects cross-cluster pages and inconsistent block order", async () => {
    const value = page([
      transaction(1, 9n, 0),
      transaction(2, 10n, 2),
      transaction(3, 10n, 1),
    ]);
    await expect(ingestActivityStream(setup(value))).rejects.toThrow("order");
    await expect(
      ingestActivityStream(setup({ ...value, cluster: "devnet" })),
    ).rejects.toThrow("stream");
  });
  it("rejects a head behind a checkpoint within the same slot", async () => {
    const value = page([transaction(2, 10n, 2), transaction(1, 10n, 1)]);
    const options = setup(value, { signature: sig(2), slot: 10n });
    await expect(ingestActivityStream(options)).rejects.toThrow("precedes checkpoint");
    expect(options.store.commit).not.toHaveBeenCalled();
  });
  it("does not write after abort", async () => {
    const options = setup(page([transaction(1, 9n, 0)]));
    const controller = new AbortController();
    controller.abort();
    await expect(
      ingestActivityStream({ ...options, signal: controller.signal }),
    ).rejects.toThrow();
    expect(options.store.commit).not.toHaveBeenCalled();
  });
});
describe("event persistence adapter", () => {
  async function verified() {
    const kathaId = "KATHA-PAUBHA-000001";
    const [artwork] = await findArtworkPda({ kathaId });
    const event = decodeRegistryEvent(
      Uint8Array.from(
        getArtworkVerifiedEventEncoder().encode({
          artwork,
          kathaId,
          authorshipEvidenceHash: new Uint8Array(32).fill(1),
          verifier: KATHA_REGISTRY_PROGRAM_ADDRESS,
          verifiedAt: 1n,
        }),
      ),
    );
    const tx = transaction(2, 10n, 1);
    tx.activities = [
      {
        outerInstructionIndex: 0,
        innerInstructionIndex: -1,
        eventIndex: 0,
        programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
        kind: "REGISTRY",
        event,
      },
    ];
    return page([tx]);
  }
  it("retains exact hashes and decimal integers, bound to the artwork PDA", async () => {
    const [event] = await prepareActivityEvents(await verified(), collection);
    expect(event?.payload.verifiedAt).toBe("1");
    expect(event?.payload.authorshipEvidenceHash).toBe("01".repeat(32));
    expect(event?.kathaId).toBe("KATHA-PAUBHA-000001");
    expect(event?.kind).toBe("REGISTRY");
  });
  it("rejects forged artwork PDA, wrong program, missing time and failed observations", async () => {
    for (const mutation of ["pda", "program", "time", "failure"]) {
      const value = await verified(),
        tx = value.transactions[0]!;
      const activity = tx.activities[0]!;
      if (
        mutation === "pda" &&
        activity.kind === "REGISTRY" &&
        activity.event.name === "ArtworkVerified"
      )
        activity.event.value.artwork = CORE_PROGRAM_ADDRESS;
      if (mutation === "program") activity.programAddress = CORE_PROGRAM_ADDRESS;
      if (mutation === "time") tx.chainRecordedAt = null;
      if (mutation === "failure") tx.outcome = "FAILED";
      await expect(prepareActivityEvents(value, collection)).rejects.toThrow();
    }
  });
  it("ignores failed transactions without observations", async () => {
    const tx = transaction(2, 10n, 1);
    tx.outcome = "FAILED";
    tx.chainRecordedAt = null;
    expect(await prepareActivityEvents(page([tx]), collection)).toEqual([]);
  });
  it("filters other Core collections before ownership persistence", async () => {
    const tx = transaction(2, 10n, 1);
    tx.activities = [
      {
        outerInstructionIndex: 0,
        innerInstructionIndex: -1,
        eventIndex: 0,
        programAddress: CORE_PROGRAM_ADDRESS,
        kind: "CORE_TRANSFER",
        transfer: {
          asset: KATHA_REGISTRY_PROGRAM_ADDRESS,
          collection: null,
          authority: KATHA_REGISTRY_PROGRAM_ADDRESS,
          newOwner: KATHA_REGISTRY_PROGRAM_ADDRESS,
        },
      },
    ];
    expect(await prepareActivityEvents(page([tx]), collection)).toEqual([]);
    const activity = tx.activities[0]!;
    if (activity.kind === "CORE_TRANSFER") activity.transfer.collection = collection;
    const [event] = await prepareActivityEvents(page([tx]), collection);
    expect(event?.payload.ownerWallet).toBe(KATHA_REGISTRY_PROGRAM_ADDRESS);
    expect(event?.kathaId).toBeNull();
  });
});

it.each(["metadata", "condition", "custody", "mint", "platform"])(
  "validates %s PDA and rejects forged bindings",
  async (kind) => {
    const kathaId = "KATHA-PAUBHA-000001";
    const [artwork] = await findArtworkPda({ kathaId });
    const common = { artwork, kathaId };
    const reportId = new Uint8Array(16).fill(1),
      hash = new Uint8Array(32).fill(2);
    const none = { __option: "None" as const };
    let event: RegistryActivityEvent;
    if (kind === "metadata")
      event = {
        name: "MetadataCommitted",
        value: {
          ...common,
          revision: (
            await findReviseMintedMetadataRevisionPda({ artwork, nextVersion: 1 })
          )[0],
          version: 1,
          documentHash: hash,
          committedBy: KATHA_REGISTRY_PROGRAM_ADDRESS,
          committedAt: 1n,
        },
      };
    else if (kind === "condition")
      event = {
        name: "ConditionRecorded",
        value: {
          ...common,
          report: (await findReportPda({ reportId }))[0],
          reportId,
          version: 1,
          reportHash: hash,
          grade: 0,
          reason: 0,
          inspectorId: reportId,
          verifier: KATHA_REGISTRY_PROGRAM_ADDRESS,
          inspectedAt: 1n,
          recordedAt: 1n,
          ownerScope: none,
          custodyRevisionScope: none,
        },
      };
    else if (kind === "custody")
      event = {
        name: "CustodyUpdated",
        value: {
          ...common,
          transition: (
            await findTransitionCustodyTransitionPda({ artwork, nextRevision: 1n })
          )[0],
          revision: 1n,
          action: 0,
          fromState: 0,
          toState: 1,
          fromSubject: none,
          toSubject: none,
          attestedBy: KATHA_REGISTRY_PROGRAM_ADDRESS,
          recordedAt: 1n,
        },
      };
    else if (kind === "mint")
      event = {
        name: "ArtworkMinted",
        value: {
          ...common,
          asset: (await findAssetPda({ artwork }))[0],
          collection,
          initialOwner: KATHA_REGISTRY_PROGRAM_ADDRESS,
          metadataVersion: 1,
          metadataHash: hash,
          conditionReport: (await findReportPda({ reportId }))[0],
          custodyRevision: 1n,
          mintedBy: KATHA_REGISTRY_PROGRAM_ADDRESS,
          mintedAt: 1n,
        },
      };
    else
      event = {
        name: "PlatformInitialized",
        value: {
          config: (await findConfigPda())[0],
          authority: KATHA_REGISTRY_PROGRAM_ADDRESS,
          collection,
          registrationAuthority: KATHA_REGISTRY_PROGRAM_ADDRESS,
          verifierAuthority: KATHA_REGISTRY_PROGRAM_ADDRESS,
          custodyAuthority: KATHA_REGISTRY_PROGRAM_ADDRESS,
          treasury: KATHA_REGISTRY_PROGRAM_ADDRESS,
        },
      };
    const tx = transaction(2, 10n, 1);
    tx.activities = [
      {
        outerInstructionIndex: 0,
        innerInstructionIndex: -1,
        eventIndex: 0,
        programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
        kind: "REGISTRY",
        event,
      },
    ];
    const [saved] = await prepareActivityEvents(page([tx]), collection);
    expect(saved?.payload.name).toBe(event.name);
    if (event.name === "MetadataCommitted") event.value.revision = CORE_PROGRAM_ADDRESS;
    if (event.name === "ConditionRecorded") event.value.report = CORE_PROGRAM_ADDRESS;
    if (event.name === "CustodyUpdated") event.value.transition = CORE_PROGRAM_ADDRESS;
    if (event.name === "ArtworkMinted") event.value.asset = CORE_PROGRAM_ADDRESS;
    if (event.name === "PlatformInitialized") event.value.config = CORE_PROGRAM_ADDRESS;
    await expect(prepareActivityEvents(page([tx]), collection)).rejects.toThrow();
  },
);
