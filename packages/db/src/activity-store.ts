import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { projectActivityAttestations } from "./activity-attestations.js";
import { indexerNetworks } from "./schema/indexer-recovery.js";
import { artworks } from "./schema/artworks.js";
import {
  indexedEvents,
  indexerCheckpoints,
  artworkOwnership,
  artworkListings,
  artworkSales,
  type NewIndexedEventRecord,
} from "./schema/blockchain-read-models.js";

export type ActivityStream = {
  cluster: "LOCALNET" | "DEVNET";
  programAddress: string;
  fromSlot: bigint;
};
export type ActivityCursor = { signature: string; slot: bigint } | null;
export type StoredActivity = Omit<
  NewIndexedEventRecord,
  "id" | "cluster" | "artworkId" | "indexedAt"
> & { kathaId: string | null; metadataUri?: string };
export type ActivityBatch = ActivityStream & {
  expected: ActivityCursor;
  head: ActivityCursor;
  events: readonly StoredActivity[];
  genesisHash?: string;
  recovery?: boolean;
  scannedThroughSlot?: bigint;
};
const sameCursor = (a: ActivityCursor, b: ActivityCursor) =>
  a?.signature === b?.signature && a?.slot === b?.slot;
type Position = Pick<
  StoredActivity,
  | "slot"
  | "transactionIndex"
  | "outerInstructionIndex"
  | "innerInstructionIndex"
  | "eventIndex"
>;
const ordered = (a: Position, b: Position) =>
  a.slot !== b.slot
    ? a.slot < b.slot
      ? -1
      : 1
    : a.transactionIndex - b.transactionIndex ||
      a.outerInstructionIndex - b.outerInstructionIndex ||
      (a.innerInstructionIndex ?? -1) - (b.innerInstructionIndex ?? -1) ||
      (a.eventIndex ?? 0) - (b.eventIndex ?? 0);
// JSONB key ordering is not evidence ordering; compare normalized contents recursively.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export class ActivityStoreConflict extends Error {
  constructor() {
    super("Activity persistence conflict");
  }
}

/** Trusted worker boundary, never exposed as an HTTP write endpoint. */
export function createActivityStore(
  db: Database,
  programs: {
    registry: string;
    core: string;
    marketplace?: string;
    collection: string;
  },
) {
  function validate(stream: ActivityStream) {
    if (
      !["LOCALNET", "DEVNET"].includes(stream.cluster) ||
      ![
        programs.registry,
        programs.core,
        ...(programs.marketplace ? [programs.marketplace] : []),
      ].includes(stream.programAddress) ||
      stream.fromSlot < 0n ||
      stream.fromSlot > 9223372036854775807n
    )
      throw new ActivityStoreConflict();
  }
  return {
    async cursor(stream: ActivityStream, recovery = false): Promise<ActivityCursor> {
      validate(stream);
      const [row] = await db
        .select()
        .from(indexerCheckpoints)
        .where(
          and(
            eq(indexerCheckpoints.cluster, stream.cluster),
            eq(indexerCheckpoints.programAddress, stream.programAddress),
          ),
        );
      if (
        row &&
        (row.fromSlot !== stream.fromSlot || (row.gapFromSlot !== null && !recovery))
      )
        throw new ActivityStoreConflict();
      return row?.lastSignature && row.lastSignatureSlot !== null
        ? { signature: row.lastSignature, slot: row.lastSignatureSlot }
        : null;
    },
    async commit(batch: ActivityBatch) {
      validate(batch);
      if (
        batch.events.length > 10000 ||
        (batch.head && batch.head.slot < batch.fromSlot) ||
        (batch.scannedThroughSlot !== undefined &&
          (batch.scannedThroughSlot < batch.fromSlot ||
            (batch.head !== null && batch.scannedThroughSlot < batch.head.slot))) ||
        (batch.expected && (!batch.head || batch.head.slot < batch.expected.slot))
      )
        throw new ActivityStoreConflict();
      return db.transaction(async (tx) => {
        // Both program streams can observe one transaction. Serialize the cluster,
        // including absent checkpoint/event rows, before taking other row locks.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`katha-indexer:${batch.cluster}`}, 0))`,
        );
        const [network] = await tx
          .select()
          .from(indexerNetworks)
          .where(
            and(
              eq(indexerNetworks.cluster, batch.cluster),
              eq(indexerNetworks.registryProgram, programs.registry),
            ),
          );
        if (
          (network &&
            (network.blocked ||
              network.genesisHash !== batch.genesisHash ||
              network.collection !== programs.collection)) ||
          (batch.genesisHash !== undefined && !network)
        )
          throw new ActivityStoreConflict();
        const where = and(
          eq(indexerCheckpoints.cluster, batch.cluster),
          eq(indexerCheckpoints.programAddress, batch.programAddress),
        );
        const [checkpoint] = await tx
          .select()
          .from(indexerCheckpoints)
          .where(where)
          .for("update");
        const current =
          checkpoint?.lastSignature && checkpoint.lastSignatureSlot !== null
            ? {
                signature: checkpoint.lastSignature,
                slot: checkpoint.lastSignatureSlot,
              }
            : null;
        if (
          checkpoint &&
          (checkpoint.fromSlot !== batch.fromSlot ||
            (checkpoint.gapFromSlot !== null && !batch.recovery))
        )
          throw new ActivityStoreConflict();
        const replay = sameCursor(current, batch.head) && !batch.recovery;
        if (!sameCursor(current, batch.expected) && !replay)
          throw new ActivityStoreConflict();
        let inserted = 0;
        for (const event of [...batch.events].sort(ordered)) {
          const { kathaId, metadataUri, ...data } = event;
          if (metadataUri !== undefined && event.payload.name !== "MetadataCommitted")
            throw new ActivityStoreConflict();
          if (
            !batch.head ||
            event.slot < batch.fromSlot ||
            event.slot > batch.head.slot ||
            !["REGISTRY", "OWNERSHIP", "LISTING", "SALE"].includes(event.kind) ||
            ![
              programs.registry,
              programs.core,
              ...(programs.marketplace ? [programs.marketplace] : []),
            ].includes(event.programAddress)
          )
            throw new ActivityStoreConflict();
          if (
            event.programAddress === programs.registry &&
            (![
              "PlatformInitialized",
              "ArtworkRegistered",
              "ArtworkVerified",
              "MetadataCommitted",
              "ConditionRecorded",
              "CustodyUpdated",
              "ArtworkMinted",
            ].includes(String(event.payload.name)) ||
              (event.payload.name === "PlatformInitialized") !== (kathaId === null))
          )
            throw new ActivityStoreConflict();
          if (
            ["PlatformInitialized", "ArtworkRegistered", "ArtworkMinted"].includes(
              String(event.payload.name),
            ) &&
            event.payload.collection !== programs.collection
          )
            throw new ActivityStoreConflict();
          let artworkId: string | null = null;
          if (kathaId !== null) {
            const [artwork] = await tx
              .select()
              .from(artworks)
              .where(eq(artworks.kathaId, kathaId))
              .for("share");
            if (!artwork) throw new ActivityStoreConflict();
            artworkId = artwork.id;
            if (
              event.payload.name === "ArtworkRegistered" &&
              (event.payload.artistId !== artwork.artistId ||
                event.payload.creationYear !== artwork.creationYear ||
                event.payload.authorshipEvidenceHash !==
                  artwork.authorshipEvidenceHash ||
                event.payload.creatorWallet !== artwork.creatorWallet ||
                event.payload.category !== artwork.category)
            )
              throw new ActivityStoreConflict();
          }
          if (
            event.programAddress === programs.registry &&
            artworkId &&
            event.payload.name !== "ArtworkRegistered"
          ) {
            const [registration] = await tx
              .select()
              .from(indexedEvents)
              .where(
                and(
                  eq(indexedEvents.cluster, batch.cluster),
                  eq(indexedEvents.artworkId, artworkId),
                  eq(indexedEvents.programAddress, programs.registry),
                  sql`${indexedEvents.payload}->>'name' = 'ArtworkRegistered'`,
                ),
              );
            if (!registration || ordered(registration, event) >= 0)
              throw new ActivityStoreConflict();
          }
          if (event.programAddress === programs.core) {
            if (
              event.kind !== "OWNERSHIP" ||
              event.payload.name !== "CoreTransfer" ||
              event.payload.collection !== programs.collection ||
              !event.assetAddress
            )
              throw new ActivityStoreConflict();
            const [binding] = await tx
              .select()
              .from(indexedEvents)
              .where(
                and(
                  eq(indexedEvents.cluster, batch.cluster),
                  eq(indexedEvents.assetAddress, event.assetAddress),
                  sql`${indexedEvents.payload}->>'name' = 'ArtworkMinted'`,
                ),
              );
            if (
              !binding?.artworkId ||
              binding.payload.collection !== programs.collection
            )
              throw new ActivityStoreConflict();
            artworkId = binding.artworkId;
          } else if (event.programAddress === programs.marketplace) {
            if (
              !event.assetAddress ||
              kathaId !== null ||
              !["LISTING", "SALE"].includes(event.kind) ||
              !["ListingCreated", "ListingReleased", "ArtworkPurchased"].includes(
                String(event.payload.name),
              ) ||
              (event.kind === "SALE") !== (event.payload.name === "ArtworkPurchased")
            )
              throw new ActivityStoreConflict();
            const [binding] = await tx
              .select()
              .from(indexedEvents)
              .where(
                and(
                  eq(indexedEvents.cluster, batch.cluster),
                  eq(indexedEvents.programAddress, programs.registry),
                  eq(indexedEvents.assetAddress, event.assetAddress),
                  sql`${indexedEvents.payload}->>'name' = 'ArtworkMinted'`,
                ),
              );
            if (
              !binding?.artworkId ||
              binding.payload.collection !== programs.collection ||
              ordered(binding, event) >= 0
            )
              throw new ActivityStoreConflict();
            artworkId = binding.artworkId;
          } else if (event.payload.name === "ArtworkMinted") {
            if (
              !artworkId ||
              event.kind !== "OWNERSHIP" ||
              event.payload.collection !== programs.collection ||
              !event.assetAddress
            )
              throw new ActivityStoreConflict();
          } else if (event.kind !== "REGISTRY") throw new ActivityStoreConflict();
          if (event.kind === "SALE") {
            const transfers = batch.events.filter(
              (e) =>
                e.programAddress === programs.core &&
                e.signature === event.signature &&
                e.outerInstructionIndex === event.outerInstructionIndex &&
                e.assetAddress === event.assetAddress,
            );
            if (
              transfers.length !== 1 ||
              transfers[0]?.payload.name !== "CoreTransfer" ||
              transfers[0]?.payload.ownerWallet !== event.payload.buyerWallet ||
              transfers[0]?.payload.authority !== event.payload.listingAddress ||
              transfers[0]?.payload.collection !== programs.collection
            )
              throw new ActivityStoreConflict();
          }
          // Terminal events omit immutable listing terms. Resolve the exact preceding
          // cycle, including on replay after a newer cycle has already been indexed.
          let cycle: typeof artworkListings.$inferSelect | undefined;
          if (event.programAddress === programs.marketplace) {
            const revision = event.payload.revision;
            if (
              typeof revision !== "string" ||
              !/^[1-9][0-9]{0,19}$/.test(revision) ||
              BigInt(revision) > 18446744073709551615n
            )
              throw new ActivityStoreConflict();
            if (event.payload.name !== "ListingCreated") {
              [cycle] = await tx
                .select()
                .from(artworkListings)
                .where(
                  and(
                    eq(artworkListings.cluster, batch.cluster),
                    eq(artworkListings.artworkId, artworkId!),
                    eq(
                      artworkListings.listingAddress,
                      String(event.payload.listingAddress),
                    ),
                    eq(artworkListings.listingRevision, BigInt(revision) - 1n),
                  ),
                );
              if (
                !cycle ||
                cycle.assetAddress !== event.assetAddress ||
                cycle.sellerWallet !== event.payload.sellerWallet
              )
                throw new ActivityStoreConflict();
              if (
                event.kind === "SALE" &&
                (event.payload.paymentMint !== cycle.paymentMint ||
                  event.payload.price !== cycle.price.toString())
              )
                throw new ActivityStoreConflict();
              data.payload = {
                ...event.payload,
                paymentMint: cycle.paymentMint,
                price: cycle.price.toString(),
                expiresAt: cycle.expiresAt.toISOString(),
              };
            }
          }
          const identity = and(
            eq(indexedEvents.cluster, batch.cluster),
            eq(indexedEvents.signature, event.signature),
            eq(indexedEvents.outerInstructionIndex, event.outerInstructionIndex),
            eq(indexedEvents.innerInstructionIndex, event.innerInstructionIndex ?? -1),
            eq(indexedEvents.eventIndex, event.eventIndex ?? 0),
          );
          const [existing] = await tx.select().from(indexedEvents).where(identity);
          if (existing) {
            if (
              existing.programAddress !== event.programAddress ||
              existing.slot !== event.slot ||
              existing.transactionIndex !== event.transactionIndex ||
              existing.kind !== event.kind ||
              existing.artworkId !== artworkId ||
              existing.assetAddress !== (event.assetAddress ?? null) ||
              existing.chainRecordedAt.getTime() !== event.chainRecordedAt.getTime() ||
              canonical(existing.payload) !== canonical(data.payload)
            )
              throw new ActivityStoreConflict();
            if (artworkId && event.programAddress === programs.registry)
              await projectActivityAttestations(tx, batch.cluster, artworkId, event);
            continue;
          }
          // A replay must reproduce retained evidence, never sneak in new events.
          if (replay) throw new ActivityStoreConflict();
          const [saved] = await tx
            .insert(indexedEvents)
            .values({ ...data, cluster: batch.cluster, artworkId })
            .returning();
          if (!saved) throw new ActivityStoreConflict();
          inserted++;
          if (artworkId && event.programAddress === programs.registry)
            await projectActivityAttestations(tx, batch.cluster, artworkId, event);
          if (
            event.programAddress === programs.marketplace &&
            artworkId &&
            event.assetAddress
          ) {
            const p = data.payload;
            if (p.name === "ListingCreated") {
              const [previousCycle] = await tx
                .select()
                .from(artworkListings)
                .where(
                  and(
                    eq(artworkListings.cluster, batch.cluster),
                    eq(artworkListings.listingAddress, String(p.listingAddress)),
                  ),
                )
                .orderBy(desc(artworkListings.listingRevision))
                .limit(1);
              if (
                BigInt(String(p.revision)) !==
                  (previousCycle ? previousCycle.listingRevision + 2n : 1n) ||
                previousCycle?.status === "ACTIVE"
              )
                throw new ActivityStoreConflict();
              if (
                p.status !== "ACTIVE" ||
                typeof p.paymentMint !== "string" ||
                typeof p.price !== "string" ||
                typeof p.expiresAt !== "string" ||
                typeof p.sellerWallet !== "string" ||
                typeof p.listingAddress !== "string"
              )
                throw new ActivityStoreConflict();
              await tx.insert(artworkListings).values({
                cluster: batch.cluster,
                artworkId,
                assetAddress: event.assetAddress,
                sourceEventId: saved.id,
                listingAddress: p.listingAddress,
                listingRevision: BigInt(String(p.revision)),
                sellerWallet: p.sellerWallet,
                paymentMint: p.paymentMint,
                price: BigInt(p.price),
                expiresAt: new Date(p.expiresAt),
                status: "ACTIVE",
              });
            } else {
              if (
                !cycle ||
                cycle.status !== "ACTIVE" ||
                !["PURCHASED", "CANCELLED", "EXPIRED"].includes(String(p.status))
              )
                throw new ActivityStoreConflict();
              if (p.name === "ArtworkPurchased") {
                await tx.insert(artworkSales).values({
                  cluster: batch.cluster,
                  artworkId,
                  assetAddress: event.assetAddress,
                  sourceEventId: saved.id,
                  listingId: cycle.id,
                  buyerWallet: String(p.buyerWallet),
                  sellerWallet: cycle.sellerWallet,
                  paymentMint: cycle.paymentMint,
                  price: cycle.price,
                  isPrimary: p.isPrimary === true,
                  proceedsWallet: String(p.proceedsWallet),
                  proceedsAmount: BigInt(String(p.proceedsAmount)),
                  artistWallet: String(p.artistWallet),
                  royaltyAmount: BigInt(String(p.royaltyAmount)),
                  treasuryWallet: String(p.treasuryWallet),
                  platformFee: BigInt(String(p.platformFee)),
                });
              }
              await tx
                .update(artworkListings)
                .set({
                  sourceEventId: saved.id,
                  status: p.status as "PURCHASED" | "CANCELLED" | "EXPIRED",
                })
                .where(eq(artworkListings.id, cycle.id));
            }
          }
          if (event.kind === "OWNERSHIP" || event.kind === "SALE") {
            const ownerWallet = event.payload.ownerWallet;
            if (typeof ownerWallet !== "string" || !artworkId || !event.assetAddress)
              throw new ActivityStoreConflict();
            const [previous] = await tx
              .select()
              .from(artworkOwnership)
              .innerJoin(
                indexedEvents,
                eq(indexedEvents.id, artworkOwnership.sourceEventId),
              )
              .where(
                and(
                  eq(artworkOwnership.cluster, batch.cluster),
                  eq(artworkOwnership.artworkId, artworkId),
                ),
              );
            if (!previous || ordered(previous.indexed_events, event) < 0) {
              await tx
                .insert(artworkOwnership)
                .values({
                  cluster: batch.cluster,
                  artworkId,
                  assetAddress: event.assetAddress,
                  ownerWallet,
                  sourceEventId: saved.id,
                })
                .onConflictDoUpdate({
                  target: [artworkOwnership.cluster, artworkOwnership.artworkId],
                  set: { ownerWallet, sourceEventId: saved.id },
                });
            }
          }
        }
        if (
          batch.recovery &&
          checkpoint?.gapThroughSlot !== null &&
          checkpoint?.gapThroughSlot !== undefined &&
          (batch.scannedThroughSlot === undefined ||
            batch.scannedThroughSlot < checkpoint.gapThroughSlot)
        )
          throw new ActivityStoreConflict();
        if ((!replay && batch.head) || batch.scannedThroughSlot !== undefined) {
          await tx
            .insert(indexerCheckpoints)
            .values({
              cluster: batch.cluster,
              programAddress: batch.programAddress,
              fromSlot: batch.fromSlot,
              ...(batch.recovery
                ? { gapFromSlot: null, gapThroughSlot: null, gapReason: null }
                : {}),
              scannedThroughSlot: batch.scannedThroughSlot ?? batch.head!.slot,
              lastSignature: batch.head?.signature ?? null,
              lastSignatureSlot: batch.head?.slot ?? null,
            })
            .onConflictDoUpdate({
              target: [indexerCheckpoints.cluster, indexerCheckpoints.programAddress],
              set: {
                ...(batch.recovery
                  ? { gapFromSlot: null, gapThroughSlot: null, gapReason: null }
                  : {}),
                scannedThroughSlot: batch.scannedThroughSlot ?? batch.head!.slot,
                lastSignature: batch.head?.signature ?? null,
                lastSignatureSlot: batch.head?.slot ?? null,
              },
            });
        }
        return { inserted, replay };
      });
    },
  };
}
export type ActivityStore = ReturnType<typeof createActivityStore>;
