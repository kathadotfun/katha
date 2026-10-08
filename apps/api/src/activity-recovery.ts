import { ActivityStoreConflict } from "@katha/db";
import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "@katha/solana/marketplace";
import type {
  ActivityStore,
  ActivityStream,
  IndexerRecoveryStore,
  IndexerGapReason,
} from "@katha/db";
import {
  isRetryableRpcFailure,
  ActivityEvidenceError,
  type ActivityReader,
  type ActivityPage,
  type HistoryReader,
  type HistorySnapshot,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { CORE_PROGRAM_ADDRESS } from "@katha/solana";
import { setTimeout } from "node:timers/promises";
import { prepareActivityEvents } from "./activity-ingestion.js";
export class HistoryGap extends Error {
  constructor(readonly reason: IndexerGapReason) {
    super("Indexer history needs recovery");
  }
}
export class IndexerNetworkChanged extends Error {
  constructor() {
    super("Indexer network binding changed");
  }
}
export async function retryRpc<T>(
  action: () => Promise<T>,
  signal?: AbortSignal,
  wait: (ms: number) => Promise<unknown> = (ms) =>
    setTimeout(ms, undefined, { ...(signal ? { signal } : {}) }),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await action();
    } catch (error) {
      if (signal?.aborted || attempt === 2 || !isRetryableRpcFailure(error))
        throw error;
      await wait(250 * 2 ** attempt);
    }
  }
}
type Transaction = ActivityPage["transactions"][number];
const compare = (a: Transaction, b: Transaction) =>
  a.slot === b.slot
    ? a.transactionIndex - b.transactionIndex
    : a.slot < b.slot
      ? -1
      : 1;

/** Freeze an upper slot; collect backwards, verify boundaries, commit oldest-first. */
export async function recoverActivityStream(options: {
  read: ActivityReader;
  history: HistoryReader;
  store: ActivityStore;
  recoveryStore: IndexerRecoveryStore;
  stream: ActivityStream;
  collection: string;
  snapshot: HistorySnapshot;
  backfill?: boolean;
  maxPages?: number;
  throughSlot?: bigint;
  signal?: AbortSignal;
}) {
  const { stream, snapshot, signal } = options;
  const programAddress =
    stream.programAddress === KATHA_REGISTRY_PROGRAM_ADDRESS
      ? KATHA_REGISTRY_PROGRAM_ADDRESS
      : stream.programAddress === CORE_PROGRAM_ADDRESS
        ? CORE_PROGRAM_ADDRESS
        : stream.programAddress === KATHA_MARKETPLACE_PROGRAM_ADDRESS
          ? KATHA_MARKETPLACE_PROGRAM_ADDRESS
          : null;
  const maxPages = options.maxPages ?? 100;
  const through = options.throughSlot ?? snapshot.finalizedSlot;
  if (
    !programAddress ||
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 1000 ||
    stream.fromSlot > through ||
    through > snapshot.finalizedSlot
  )
    throw new Error("Invalid recovery scope");
  if (
    !(await options.recoveryStore.bindNetwork(
      stream.cluster,
      snapshot.genesisHash,
      snapshot.finalizedSlot,
    ))
  )
    throw new IndexerNetworkChanged();
  const checkpoint = await options.recoveryStore.checkpoint(stream);
  const backfill =
    options.backfill === true ||
    (checkpoint?.gapFromSlot !== null && checkpoint?.gapFromSlot !== undefined);
  const expected = await options.store.cursor(stream, true);
  if (
    checkpoint?.scannedThroughSlot !== null &&
    checkpoint?.scannedThroughSlot !== undefined &&
    through < checkpoint.scannedThroughSlot
  )
    throw new Error("Backfill cannot rewind a checkpoint");
  const from = backfill || !expected ? stream.fromSlot : expected.slot;
  const fail = async (reason: IndexerGapReason): Promise<never> => {
    await options.recoveryStore.gap(stream, reason, through);
    throw new HistoryGap(reason);
  };
  if (snapshot.firstAvailableBlock > from) return fail("HISTORY_UNAVAILABLE");
  const transactions = new Map<string, Transaction>();
  let before: string | undefined,
    previousOldest: Transaction | undefined,
    reached = false,
    exhausted = false;
  try {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const page: ActivityPage = await retryRpc(
        () =>
          options.read(
            { programAddress, limit: 100, ...(before ? { before } : {}) },
            signal,
          ),
        signal,
      );
      if (
        page.cluster.toUpperCase() !== stream.cluster ||
        page.programAddress !== programAddress
      )
        throw new ActivityEvidenceError();
      if (page.genesisHash !== snapshot.genesisHash) {
        if (page.genesisHash)
          await options.recoveryStore.bindNetwork(
            stream.cluster,
            page.genesisHash,
            snapshot.finalizedSlot,
          );
        throw new IndexerNetworkChanged();
      }
      const sorted = [...page.transactions].sort(compare);
      if (!sorted.length && (page.headSignature !== null || page.nextBefore !== null))
        throw new ActivityEvidenceError();
      if (
        sorted.length &&
        (sorted.at(-1)!.signature !== page.headSignature ||
          (previousOldest && compare(sorted.at(-1)!, previousOldest) >= 0))
      )
        throw new ActivityEvidenceError();
      for (const tx of sorted) {
        if (transactions.has(tx.signature)) throw new ActivityEvidenceError();
        transactions.set(tx.signature, tx);
      }
      const boundary = expected ? transactions.get(expected.signature) : undefined;
      if (boundary && boundary.slot !== expected!.slot)
        throw new ActivityEvidenceError();
      const belowStart = sorted.some((tx) => tx.slot < stream.fromSlot);
      if (
        (!backfill && expected && boundary) ||
        ((backfill || !expected) && (belowStart || page.nextBefore === null))
      ) {
        reached = true;
        break;
      }
      if (page.nextBefore === null) {
        exhausted = true;
        break;
      }
      if (
        !sorted.length ||
        page.nextBefore !== sorted[0]!.signature ||
        page.nextBefore === before
      )
        throw new ActivityEvidenceError();
      previousOldest = sorted[0];
      before = page.nextBefore;
    }
    if (!reached || (expected && !transactions.has(expected.signature)))
      return fail(reached || exhausted ? "BOUNDARY_MISSING" : "PAGE_LIMIT");
    const boundary = expected ? transactions.get(expected.signature) : undefined;
    const selected = [...transactions.values()]
      .filter(
        (tx) =>
          tx.slot <= through &&
          tx.slot >= stream.fromSlot &&
          (backfill || !boundary || compare(tx, boundary) >= 0),
      )
      .sort(compare);
    const latest = selected.at(-1);
    const head = latest ? { signature: latest.signature, slot: latest.slot } : expected;
    if (expected && (!head || head.slot < expected.slot))
      throw new ActivityEvidenceError();
    let events: Awaited<ReturnType<typeof prepareActivityEvents>>;
    try {
      events = await prepareActivityEvents(
        {
          cluster: stream.cluster === "LOCALNET" ? "localnet" : "devnet",
          programAddress,
          headSignature: head?.signature ?? null,
          nextBefore: null,
          transactions: selected,
        },
        options.collection,
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      return fail("EVIDENCE_INVALID");
    }
    if (events.length > 10000) return fail("PAGE_LIMIT");
    const after = await retryRpc(() => options.history.snapshot(signal), signal);
    if (
      after.genesisHash !== snapshot.genesisHash ||
      after.finalizedSlot < snapshot.finalizedSlot
    ) {
      await options.recoveryStore.bindNetwork(
        stream.cluster,
        after.genesisHash,
        after.finalizedSlot,
      );
      throw new IndexerNetworkChanged();
    }
    signal?.throwIfAborted();
    return await options.store.commit({
      ...stream,
      expected,
      head,
      events,
      genesisHash: snapshot.genesisHash,
      recovery: backfill,
      scannedThroughSlot: through,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof IndexerNetworkChanged) {
      await options.recoveryStore.gap(
        stream,
        "NETWORK_CHANGED",
        snapshot.finalizedSlot,
      );
      throw error;
    }
    if (
      error instanceof ActivityEvidenceError ||
      error instanceof ActivityStoreConflict
    )
      return fail("EVIDENCE_INVALID");
    throw error;
  }
}

export async function reconcileCoreOwnership(options: {
  history: HistoryReader;
  recoveryStore: IndexerRecoveryStore;
  stream: ActivityStream;
  collection: string;
  snapshot: HistorySnapshot;
  signal?: AbortSignal;
}) {
  let mismatches = 0;
  for (const owner of await options.recoveryStore.owners(options.stream.cluster)) {
    options.signal?.throwIfAborted();
    const minimum =
      owner.slot > options.snapshot.finalizedSlot
        ? owner.slot
        : options.snapshot.finalizedSlot;
    const observation = await retryRpc(
      () =>
        options.history.owner(
          owner.assetAddress,
          options.collection,
          minimum,
          options.signal,
        ),
      options.signal,
    );
    const after = await retryRpc(
      () => options.history.snapshot(options.signal),
      options.signal,
    );
    if (
      after.genesisHash !== options.snapshot.genesisHash ||
      after.finalizedSlot < options.snapshot.finalizedSlot
    ) {
      await options.recoveryStore.bindNetwork(
        options.stream.cluster,
        after.genesisHash,
        after.finalizedSlot,
      );
      throw new IndexerNetworkChanged();
    }
    const status = await options.recoveryStore.reconcile(
      options.stream.cluster,
      options.snapshot.genesisHash,
      owner,
      observation,
    );
    if (status !== "MATCH") {
      mismatches++;
      await options.recoveryStore.gap(
        options.stream,
        "OWNER_MISMATCH",
        observation.slot,
      );
    }
  }
  return { mismatches };
}
