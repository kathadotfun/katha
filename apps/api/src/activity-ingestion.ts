import type { ActivityStore, ActivityStream, StoredActivity } from "@katha/db";
import {
  CORE_PROGRAM_ADDRESS,
  type ActivityReader,
  type ActivityPage,
} from "@katha/solana";
import {
  findArtworkPda,
  findAssetPda,
  findConfigPda,
  findReportPda,
  findReviseMintedMetadataRevisionPda,
  findTransitionCustodyTransitionPda,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
} from "@katha/solana/registry";

/** Generated event values become JSON without floats for chain integers. */
function jsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  return value;
}
export async function prepareActivityEvents(
  page: ActivityPage,
  collection: string,
): Promise<StoredActivity[]> {
  const result: StoredActivity[] = [];
  for (const tx of page.transactions) {
    if (tx.outcome === "FAILED") {
      if (tx.activities.length) throw new Error("Failed activity");
      continue;
    }
    if (!tx.chainRecordedAt && tx.activities.length)
      throw new Error("Missing activity time");
    for (const activity of tx.activities) {
      const base = {
        signature: tx.signature,
        slot: tx.slot,
        transactionIndex: tx.transactionIndex,
        outerInstructionIndex: activity.outerInstructionIndex,
        innerInstructionIndex: activity.innerInstructionIndex,
        eventIndex: activity.eventIndex,
        chainRecordedAt: tx.chainRecordedAt!,
      };
      if (activity.kind === "CORE_TRANSFER") {
        if (activity.programAddress !== CORE_PROGRAM_ADDRESS)
          throw new Error("Unexpected Core program");
        if (activity.transfer.collection !== collection) continue;
        result.push({
          ...base,
          programAddress: activity.programAddress,
          kind: "OWNERSHIP",
          kathaId: null,
          assetAddress: activity.transfer.asset,
          payload: {
            name: "CoreTransfer",
            ...activity.transfer,
            ownerWallet: activity.transfer.newOwner,
          },
        });
        continue;
      }
      if (activity.programAddress !== KATHA_REGISTRY_PROGRAM_ADDRESS)
        throw new Error("Unexpected Registry program");
      const { name, value } = activity.event;
      const payload: Record<string, unknown> = {
        name,
        ...(jsonValue(value) as Record<string, unknown>),
      };
      let kathaId: string | null = null;
      let assetAddress: string | null = null;
      if (name === "PlatformInitialized") {
        if (
          value.config !== (await findConfigPda())[0] ||
          value.collection !== collection
        )
          throw new Error("Unexpected platform configuration");
      } else {
        kathaId = value.kathaId;
        if (value.artwork !== (await findArtworkPda({ kathaId }))[0])
          throw new Error("Unexpected artwork PDA");
        if (
          name === "MetadataCommitted" &&
          (value.version < 1 ||
            value.revision !==
              (
                await findReviseMintedMetadataRevisionPda({
                  artwork: value.artwork,
                  nextVersion: value.version,
                })
              )[0])
        )
          throw new Error("Unexpected metadata revision PDA");
        if (
          name === "ConditionRecorded" &&
          value.report !== (await findReportPda({ reportId: value.reportId }))[0]
        )
          throw new Error("Unexpected condition report PDA");
        if (
          name === "CustodyUpdated" &&
          (value.revision < 1n ||
            value.transition !==
              (
                await findTransitionCustodyTransitionPda({
                  artwork: value.artwork,
                  nextRevision: value.revision,
                })
              )[0])
        )
          throw new Error("Unexpected custody transition PDA");
        if (name === "ArtworkRegistered") {
          if (value.collection !== collection)
            throw new Error("Unexpected artwork collection");
          payload.artistId = value.artistId;
          payload.creatorWallet =
            value.creatorWallet.__option === "Some" ? value.creatorWallet.value : null;
          payload.category = ["MANDALA", "PAUBHA", "THANGKA"][value.category];
        }
        if (name === "ArtworkMinted") {
          if (
            value.collection !== collection ||
            value.asset !== (await findAssetPda({ artwork: value.artwork }))[0]
          )
            throw new Error("Unexpected minted asset");
          assetAddress = value.asset;
          payload.ownerWallet = value.initialOwner;
        }
      }
      result.push({
        ...base,
        ...(activity.metadataUri === undefined
          ? {}
          : { metadataUri: activity.metadataUri }),
        programAddress: activity.programAddress,
        kind: name === "ArtworkMinted" ? "OWNERSHIP" : "REGISTRY",
        kathaId,
        assetAddress,
        payload,
      });
    }
  }
  return result;
}

/** One bounded complete window. Pagination/recovery is deliberately a separate step. */
export async function ingestActivityStream(options: {
  read: ActivityReader;
  store: ActivityStore;
  stream: ActivityStream;
  collection: string;
  signal?: AbortSignal;
}) {
  const programAddress =
    options.stream.programAddress === KATHA_REGISTRY_PROGRAM_ADDRESS
      ? KATHA_REGISTRY_PROGRAM_ADDRESS
      : options.stream.programAddress === CORE_PROGRAM_ADDRESS
        ? CORE_PROGRAM_ADDRESS
        : null;
  if (!programAddress) throw new Error("Unexpected activity stream");
  const expected = await options.store.cursor(options.stream);
  options.signal?.throwIfAborted();
  // Include the saved signature: `until` would hide proof that it was reached.
  const page = await options.read(
    {
      programAddress,
      limit: 100,
    },
    options.signal,
  );
  if (
    page.programAddress !== options.stream.programAddress ||
    page.cluster.toUpperCase() !== options.stream.cluster
  )
    throw new Error("Unexpected activity stream");
  const boundary = expected
    ? page.transactions.find((tx) => tx.signature === expected.signature)
    : page.transactions.find((tx) => tx.slot < options.stream.fromSlot);
  if (expected && (!boundary || boundary.slot !== expected.slot))
    throw new Error("Activity checkpoint not reached");
  if (!expected && !boundary) throw new Error("Activity start boundary not reached");
  const selected = page.transactions.filter(
    (tx) =>
      tx.slot >= options.stream.fromSlot &&
      (!boundary ||
        tx.slot > boundary.slot ||
        (tx.slot === boundary.slot && tx.transactionIndex > boundary.transactionIndex)),
  );
  const headTx = page.transactions.find((tx) => tx.signature === page.headSignature);
  if (!headTx) throw new Error("Missing activity head");
  if (
    expected &&
    boundary &&
    (headTx.slot < boundary.slot ||
      (headTx.slot === boundary.slot &&
        headTx.transactionIndex < boundary.transactionIndex))
  )
    throw new Error("Activity head precedes checkpoint");
  // Discovery order and actual block order must agree at the boundary/head.
  if (
    selected.some(
      (tx) =>
        tx.slot > headTx.slot ||
        (tx.slot === headTx.slot && tx.transactionIndex > headTx.transactionIndex),
    )
  )
    throw new Error("Inconsistent activity order");
  const head =
    headTx.slot < options.stream.fromSlot
      ? null
      : { signature: headTx.signature, slot: headTx.slot };
  const events = await prepareActivityEvents(
    { ...page, transactions: selected },
    options.collection,
  );
  options.signal?.throwIfAborted();
  return options.store.commit({ ...options.stream, expected, head, events });
}
