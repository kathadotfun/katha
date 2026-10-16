import { expect, it, vi } from "vitest";
import type { ActivityStore, IndexerRecoveryStore } from "@katha/db";
import {
  CORE_PROGRAM_ADDRESS,
  ActivityEvidenceError,
  type ActivityPage,
  type HistoryReader,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import {
  IndexerNetworkChanged,
  recoverActivityStream,
  reconcileCoreOwnership,
  retryRpc,
} from "../src/activity-recovery.js";
const genesisHash = "11111111111111111111111111111111";
const snapshot = { genesisHash, firstAvailableBlock: 0n, finalizedSlot: 30n };
const stream = {
  cluster: "LOCALNET" as const,
  programAddress: CORE_PROGRAM_ADDRESS,
  fromSlot: 10n,
};
const collection = KATHA_REGISTRY_PROGRAM_ADDRESS;
const sig = (n: number) => String(n).repeat(64);
function transaction(
  n: number,
  slot: bigint,
  transactionIndex = 0,
): ActivityPage["transactions"][number] {
  return {
    signature: sig(n),
    slot,
    transactionIndex,
    outcome: "SUCCESS",
    chainRecordedAt: new Date(1000),
    activities: [
      {
        kind: "CORE_TRANSFER",
        programAddress: CORE_PROGRAM_ADDRESS,
        outerInstructionIndex: 0,
        innerInstructionIndex: -1,
        eventIndex: 0,
        transfer: {
          asset: KATHA_REGISTRY_PROGRAM_ADDRESS,
          authority: CORE_PROGRAM_ADDRESS,
          newOwner: KATHA_REGISTRY_PROGRAM_ADDRESS,
          collection,
        },
      },
    ],
  };
}
function page(txs: ActivityPage["transactions"], more = false): ActivityPage {
  return {
    cluster: "localnet",
    programAddress: CORE_PROGRAM_ADDRESS,
    genesisHash,
    headSignature: txs.at(-1)?.signature ?? null,
    nextBefore: more ? txs[0]!.signature : null,
    transactions: txs,
  };
}
function setup() {
  const store = {
    cursor: vi.fn().mockResolvedValue(null),
    commit: vi.fn().mockResolvedValue({ inserted: 0, replay: false }),
  } satisfies ActivityStore;
  const recoveryStore = {
    checkpoint: vi.fn().mockResolvedValue(null),
    bindNetwork: vi.fn().mockResolvedValue(true),
    gap: vi.fn().mockResolvedValue(undefined),
    owners: vi.fn().mockResolvedValue([]),
    reconcile: vi.fn().mockResolvedValue("MATCH"),
  } satisfies IndexerRecoveryStore;
  const history = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    owner: vi
      .fn()
      .mockResolvedValue({ slot: 30n, owner: collection, status: "PRESENT" }),
  } satisfies HistoryReader;
  const read = vi.fn().mockResolvedValue(page([]));
  return { store, recoveryStore, history, read, stream, collection, snapshot };
}
it("collects backwards, freezes the upper slot and acknowledges globally oldest-first", async () => {
  const options = setup();
  options.read
    .mockResolvedValueOnce(page([transaction(3, 20n), transaction(4, 40n)], true))
    .mockResolvedValueOnce(page([transaction(1, 9n), transaction(2, 10n)]));
  await recoverActivityStream(options);
  // Core is discovered through the collection, not the network-wide program history.
  expect(options.read.mock.calls[1]?.[0]).toEqual({
    programAddress: CORE_PROGRAM_ADDRESS,
    discoveryAddress: collection,
    limit: 100,
    before: sig(3),
  });
  const batch = options.store.commit.mock.calls[0]![0];
  expect(batch.events.map((e: { slot: bigint }) => e.slot)).toEqual([10n, 20n]);
  expect(batch.head).toEqual({ signature: sig(3), slot: 20n });
  expect(batch.scannedThroughSlot).toBe(30n);
});
it("discovers the Registry stream through its own program address", async () => {
  const options = setup();
  options.read.mockResolvedValueOnce({
    ...page([]),
    programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
  });
  await recoverActivityStream({
    ...options,
    stream: { ...stream, programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
  });
  expect(options.read.mock.calls[0]?.[0]).toEqual({
    programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
    limit: 100,
  });
});
it("includes the saved boundary for exact replay checks across same-slot pages", async () => {
  const options = setup();
  options.store.cursor.mockResolvedValue({ signature: sig(2), slot: 20n });
  options.read
    .mockResolvedValueOnce(page([transaction(3, 20n, 2)], true))
    .mockResolvedValueOnce(page([transaction(2, 20n, 1)]));
  await recoverActivityStream(options);
  expect(
    options.store.commit.mock.calls[0]![0].events.map(
      (e: { transactionIndex: number }) => e.transactionIndex,
    ),
  ).toEqual([1, 2]);
});
it("accepts an exhausted empty stream when the ledger covers the configured start", async () => {
  const options = setup();
  await recoverActivityStream(options);
  expect(options.store.commit).toHaveBeenCalledWith(
    expect.objectContaining({ head: null, scannedThroughSlot: 30n, events: [] }),
  );
});
it("records pruning as a gap without writing events", async () => {
  const options = setup();
  options.snapshot = { ...snapshot, firstAvailableBlock: 11n };
  await expect(recoverActivityStream(options)).rejects.toMatchObject({
    reason: "HISTORY_UNAVAILABLE",
  });
  expect(options.recoveryStore.gap).toHaveBeenCalledWith(
    stream,
    "HISTORY_UNAVAILABLE",
    30n,
  );
  expect(options.store.commit).not.toHaveBeenCalled();
});
it("records a missing saved boundary even after exhausted pagination", async () => {
  const options = setup();
  options.store.cursor.mockResolvedValue({ signature: sig(2), slot: 20n });
  options.read
    .mockResolvedValueOnce(page([transaction(3, 25n)], true))
    .mockResolvedValueOnce(page([transaction(1, 9n)]));
  await expect(recoverActivityStream(options)).rejects.toMatchObject({
    reason: "BOUNDARY_MISSING",
  });
  expect(options.store.commit).not.toHaveBeenCalled();
});
it("records a page budget gap with no partial checkpoint acknowledgement", async () => {
  const options = setup();
  options.read.mockResolvedValue(page([transaction(3, 25n)], true));
  await expect(
    recoverActivityStream({ ...options, maxPages: 1 }),
  ).rejects.toMatchObject({ reason: "PAGE_LIMIT" });
  expect(options.store.commit).not.toHaveBeenCalled();
});
it.each(["overlap", "order", "boundary-slot"])(
  "rejects corrupt %s evidence before acknowledgement",
  async (failure) => {
    const options = setup();
    options.store.cursor.mockResolvedValue({ signature: sig(2), slot: 20n });
    const first = page([transaction(3, 25n)], true);
    options.read
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(
        page([
          transaction(2, failure === "boundary-slot" ? 21n : 20n),
          ...(failure === "overlap"
            ? [transaction(3, 25n)]
            : failure === "order"
              ? [transaction(4, 26n)]
              : []),
        ]),
      );
    await expect(recoverActivityStream(options)).rejects.toMatchObject({
      reason: "EVIDENCE_INVALID",
    });
    expect(options.store.commit).not.toHaveBeenCalled();
  },
);
it("uses full history for explicit backfill or an existing gap", async () => {
  const options = setup();
  options.store.cursor.mockResolvedValue({ signature: sig(3), slot: 20n });
  options.recoveryStore.checkpoint.mockResolvedValue({
    gapFromSlot: 10n,
    scannedThroughSlot: 20n,
  });
  options.read
    .mockResolvedValueOnce(page([transaction(3, 20n)], true))
    .mockResolvedValueOnce(page([transaction(1, 9n), transaction(2, 10n)]));
  await recoverActivityStream(options);
  const batch = options.store.commit.mock.calls[0]![0];
  expect(batch.recovery).toBe(true);
  expect(batch.events).toHaveLength(2);
});
it("supports an explicit historical upper slot without rewinding an existing checkpoint", async () => {
  const options = setup();
  options.read.mockResolvedValue(
    page([transaction(1, 9n), transaction(2, 10n), transaction(3, 25n)]),
  );
  await recoverActivityStream({ ...options, backfill: true, throughSlot: 20n });
  expect(options.store.commit.mock.calls[0]![0].head).toEqual({
    signature: sig(2),
    slot: 10n,
  });
  options.recoveryStore.checkpoint.mockResolvedValue({ scannedThroughSlot: 30n });
  await expect(
    recoverActivityStream({ ...options, backfill: true, throughSlot: 20n }),
  ).rejects.toThrow("rewind");
});
it("stops when the genesis changes during pagination or before commit", async () => {
  const options = setup();
  options.read.mockResolvedValue({ ...page([]), genesisHash: "changed" });
  await expect(recoverActivityStream(options)).rejects.toBeInstanceOf(
    IndexerNetworkChanged,
  );
  expect(options.store.commit).not.toHaveBeenCalled();
  const later = setup();
  later.history.snapshot.mockResolvedValue({ ...snapshot, genesisHash: "changed" });
  await expect(recoverActivityStream(later)).rejects.toBeInstanceOf(
    IndexerNetworkChanged,
  );
  expect(later.store.commit).not.toHaveBeenCalled();
});
it("stops for an already blocked network or aborted collection", async () => {
  const options = setup();
  options.recoveryStore.bindNetwork.mockResolvedValue(false);
  await expect(recoverActivityStream(options)).rejects.toBeInstanceOf(
    IndexerNetworkChanged,
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    recoverActivityStream({ ...setup(), signal: controller.signal }),
  ).rejects.toThrow();
});
it("retries only transient transport failures, with bounded abortable waits", async () => {
  const network = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
  const action = vi.fn().mockRejectedValueOnce(network).mockResolvedValue("ok"),
    wait = vi.fn().mockResolvedValue(undefined);
  expect(await retryRpc(action, undefined, wait)).toBe("ok");
  expect(wait).toHaveBeenCalledWith(250);
  action.mockReset().mockRejectedValue(network);
  await expect(retryRpc(action, undefined, wait)).rejects.toBe(network);
  expect(action).toHaveBeenCalledTimes(3);
  action.mockReset().mockRejectedValue(new ActivityEvidenceError());
  await expect(retryRpc(action, undefined, wait)).rejects.toBeInstanceOf(
    ActivityEvidenceError,
  );
  expect(action).toHaveBeenCalledTimes(1);
});
it.each(["MATCH", "MISMATCH", "MISSING", "INVALID", "STALE"])(
  "records %s reconciliation without changing indexed ownership",
  async (status) => {
    const options = setup();
    const owner = {
      artworkId: "synthetic",
      assetAddress: collection,
      ownerWallet: collection,
      sourceEventId: "source",
      slot: 20n,
    };
    options.recoveryStore.owners.mockResolvedValue([owner]);
    options.recoveryStore.reconcile.mockResolvedValue(status);
    const result = await reconcileCoreOwnership(options);
    expect(result.mismatches).toBe(status === "MATCH" ? 0 : 1);
    expect(options.history.owner).toHaveBeenCalledWith(
      collection,
      collection,
      30n,
      undefined,
    );
    expect(options.store.commit).not.toHaveBeenCalled();
    expect(options.recoveryStore.gap).toHaveBeenCalledTimes(status === "MATCH" ? 0 : 1);
  },
);
it("does not reconcile observations across a network reset", async () => {
  const options = setup();
  options.recoveryStore.owners.mockResolvedValue([
    {
      artworkId: "synthetic",
      assetAddress: collection,
      ownerWallet: collection,
      sourceEventId: "source",
      slot: 20n,
    },
  ]);
  options.history.snapshot.mockResolvedValue({ ...snapshot, finalizedSlot: 10n });
  await expect(reconcileCoreOwnership(options)).rejects.toBeInstanceOf(
    IndexerNetworkChanged,
  );
  expect(options.recoveryStore.reconcile).not.toHaveBeenCalled();
});

it("records invalid Marketplace persistence evidence as a gap without advancing", async () => {
  const { KATHA_MARKETPLACE_PROGRAM_ADDRESS } =
    await import("@katha/solana/marketplace");
  const { ActivityStoreConflict } = await import("@katha/db");
  const f = setup();
  f.store.commit.mockRejectedValue(new ActivityStoreConflict());
  const p = { ...page([]), programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS };
  await expect(
    recoverActivityStream({
      ...f,
      read: vi.fn().mockResolvedValue(p),
      stream: { ...stream, programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS },
      collection,
      snapshot,
    }),
  ).rejects.toThrow("needs recovery");
  expect(f.recoveryStore.gap).toHaveBeenCalledWith(
    { ...stream, programAddress: KATHA_MARKETPLACE_PROGRAM_ADDRESS },
    "EVIDENCE_INVALID",
    30n,
  );
});
