import {
  KATHA_MARKETPLACE_PROGRAM_ADDRESS,
  findConfigPda as findMarketplaceConfigPda,
  findListingPda,
  SaleKind,
  ListingStatus,
} from "@katha/solana/marketplace";
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
      if (activity.kind === "MARKETPLACE") {
        if (activity.programAddress !== KATHA_MARKETPLACE_PROGRAM_ADDRESS)
          throw new Error("Unexpected Marketplace program");
        const { name, value } = activity.event;
        if (activity.collection !== collection)
          throw new Error("Unexpected marketplace collection");
        if (name === "MarketplaceInitialized") {
          if (
            value.config !== (await findMarketplaceConfigPda())[0] ||
            value.registryProgram !== KATHA_REGISTRY_PROGRAM_ADDRESS ||
            value.registryConfig !== (await findConfigPda())[0] ||
            value.collection !== collection
          )
            throw new Error("Unexpected marketplace configuration");
          continue;
        }
        if (
          value.asset !== (await findAssetPda({ artwork: value.artwork }))[0] ||
          value.listing !== (await findListingPda({ asset: value.asset }))[0] ||
          value.revision < 1n
        )
          throw new Error("Unexpected marketplace binding");
        const payload: Record<string, unknown> = {
          name,
          ...(jsonValue(value) as Record<string, unknown>),
          listingAddress: value.listing,
          sellerWallet: value.seller,
        };
        if (name === "ListingCreated") {
          if (
            value.price < 1n ||
            value.expiresAt <= value.createdAt ||
            value.conditionVersion < 1 ||
            value.custodyRevision < 1n
          )
            throw new Error("Invalid listing terms");
          payload.expiresAt = new Date(Number(value.expiresAt) * 1000).toISOString();
          payload.status = "ACTIVE";
        } else if (name === "ListingReleased") {
          if (![ListingStatus.Cancelled, ListingStatus.Expired].includes(value.status))
            throw new Error("Invalid listing release");
          payload.status =
            value.status === ListingStatus.Cancelled ? "CANCELLED" : "EXPIRED";
        } else {
          if (
            value.price < 1n ||
            value.sellerProceeds + value.artistProceeds + value.treasuryFee !==
              value.price ||
            value.completedSales < 1n ||
            (value.saleKind === SaleKind.Primary &&
              (value.sellerProceeds !== 0n || value.completedSales !== 1n))
          )
            throw new Error("Invalid settlement amounts");
          const primary = value.saleKind === SaleKind.Primary;
          Object.assign(payload, {
            status: "PURCHASED",
            buyerWallet: value.buyer,
            ownerWallet: value.buyer,
            isPrimary: primary,
            proceedsWallet: primary ? value.artistPayout : value.seller,
            proceedsAmount: (primary
              ? value.artistProceeds
              : value.sellerProceeds
            ).toString(),
            artistWallet: value.artistPayout,
            royaltyAmount: (primary ? 0n : value.artistProceeds).toString(),
            treasuryWallet: value.treasury,
            platformFee: value.treasuryFee.toString(),
          });
        }
        result.push({
          ...base,
          programAddress: activity.programAddress,
          kind: name === "ArtworkPurchased" ? "SALE" : "LISTING",
          kathaId: null,
          assetAddress: value.asset,
          payload,
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
        : options.stream.programAddress === KATHA_MARKETPLACE_PROGRAM_ADDRESS
          ? KATHA_MARKETPLACE_PROGRAM_ADDRESS
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
