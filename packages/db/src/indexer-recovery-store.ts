import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import {
  indexedEvents,
  indexerCheckpoints,
  artworkOwnership,
} from "./schema/blockchain-read-models.js";
import {
  indexerNetworks,
  ownershipReconciliations,
} from "./schema/indexer-recovery.js";
import type { ActivityStream } from "./activity-store.js";
export type IndexerGapReason =
  | "HISTORY_UNAVAILABLE"
  | "BOUNDARY_MISSING"
  | "PAGE_LIMIT"
  | "EVIDENCE_INVALID"
  | "OWNER_MISMATCH"
  | "NETWORK_CHANGED"
  | "NETWORK_UNBOUND";
export function createIndexerRecoveryStore(
  db: Database,
  programs: { registry: string; core: string; collection: string },
) {
  const lock = (cluster: string) =>
    sql`select pg_advisory_xact_lock(hashtextextended(${`katha-indexer:${cluster}`}, 0))`;
  return {
    async checkpoint(stream: ActivityStream) {
      const [row] = await db
        .select()
        .from(indexerCheckpoints)
        .where(
          and(
            eq(indexerCheckpoints.cluster, stream.cluster),
            eq(indexerCheckpoints.programAddress, stream.programAddress),
          ),
        );
      return row ?? null;
    },
    async bindNetwork(
      cluster: ActivityStream["cluster"],
      genesisHash: string,
      finalizedSlot: bigint,
    ) {
      return db.transaction(async (tx) => {
        await tx.execute(lock(cluster));
        const where = and(
          eq(indexerNetworks.cluster, cluster),
          eq(indexerNetworks.registryProgram, programs.registry),
        );
        const [existing] = await tx
          .select()
          .from(indexerNetworks)
          .where(where)
          .for("update");
        if (existing) {
          if (existing.blocked) return false;
          if (
            (finalizedSlot < existing.finalizedSlot ||
              existing.collection !== programs.collection) &&
            existing.genesisHash === genesisHash
          ) {
            await tx
              .update(indexerCheckpoints)
              .set({
                gapReason: "NETWORK_CHANGED",
                gapFromSlot: sql`${indexerCheckpoints.fromSlot}`,
                gapThroughSlot: sql`greatest(${indexerCheckpoints.fromSlot}, coalesce(${indexerCheckpoints.scannedThroughSlot}, ${indexerCheckpoints.fromSlot}))`,
              })
              .where(
                and(
                  eq(indexerCheckpoints.cluster, cluster),
                  inArray(indexerCheckpoints.programAddress, [
                    programs.registry,
                    programs.core,
                  ]),
                ),
              );
            return false;
          }
          if (
            existing.genesisHash !== genesisHash ||
            existing.collection !== programs.collection
          ) {
            await tx.update(indexerNetworks).set({ blocked: true }).where(where);
            await tx
              .update(indexerCheckpoints)
              .set({
                gapReason: "NETWORK_CHANGED",
                gapFromSlot: sql`${indexerCheckpoints.fromSlot}`,
                gapThroughSlot: sql`greatest(${indexerCheckpoints.fromSlot}, coalesce(${indexerCheckpoints.scannedThroughSlot}, ${indexerCheckpoints.fromSlot}))`,
              })
              .where(
                and(
                  eq(indexerCheckpoints.cluster, cluster),
                  inArray(indexerCheckpoints.programAddress, [
                    programs.registry,
                    programs.core,
                  ]),
                ),
              );
            return false;
          }
          await tx.update(indexerNetworks).set({ finalizedSlot }).where(where);
          return true;
        }
        // Older checkpoints have no proven genesis. Do not silently adopt them.
        const [legacy] = await tx
          .select()
          .from(indexerCheckpoints)
          .where(
            and(
              eq(indexerCheckpoints.cluster, cluster),
              inArray(indexerCheckpoints.programAddress, [
                programs.registry,
                programs.core,
              ]),
            ),
          )
          .limit(1);
        await tx.insert(indexerNetworks).values({
          cluster,
          registryProgram: programs.registry,
          collection: programs.collection,
          genesisHash,
          finalizedSlot,
          blocked: Boolean(legacy),
        });
        if (legacy)
          await tx
            .update(indexerCheckpoints)
            .set({
              gapReason: "NETWORK_UNBOUND",
              gapFromSlot: sql`${indexerCheckpoints.fromSlot}`,
              gapThroughSlot: sql`greatest(${indexerCheckpoints.fromSlot}, coalesce(${indexerCheckpoints.scannedThroughSlot}, ${indexerCheckpoints.fromSlot}))`,
            })
            .where(
              and(
                eq(indexerCheckpoints.cluster, cluster),
                inArray(indexerCheckpoints.programAddress, [
                  programs.registry,
                  programs.core,
                ]),
              ),
            );
        return !legacy;
      });
    },
    async gap(stream: ActivityStream, reason: IndexerGapReason, through: bigint) {
      if (
        ![programs.registry, programs.core].includes(stream.programAddress) ||
        through < stream.fromSlot
      )
        throw new Error("Invalid gap scope");
      await db.transaction(async (tx) => {
        await tx.execute(lock(stream.cluster));
        const where = and(
          eq(indexerCheckpoints.cluster, stream.cluster),
          eq(indexerCheckpoints.programAddress, stream.programAddress),
        );
        const [current] = await tx
          .select()
          .from(indexerCheckpoints)
          .where(where)
          .for("update");
        if (current && current.fromSlot !== stream.fromSlot)
          throw new Error("Invalid gap start");
        if (
          current?.gapReason === "NETWORK_CHANGED" ||
          current?.gapReason === "NETWORK_UNBOUND"
        )
          return;
        if (
          reason === "OWNER_MISMATCH" &&
          current?.gapFromSlot !== null &&
          current?.gapFromSlot !== undefined &&
          current.gapReason !== "OWNER_MISMATCH"
        )
          return;
        const gapFromSlot = current?.gapFromSlot ?? stream.fromSlot;
        const gapThroughSlot =
          current?.gapThroughSlot && current.gapThroughSlot > through
            ? current.gapThroughSlot
            : through;
        await tx
          .insert(indexerCheckpoints)
          .values({ ...stream, gapReason: reason, gapFromSlot, gapThroughSlot })
          .onConflictDoUpdate({
            target: [indexerCheckpoints.cluster, indexerCheckpoints.programAddress],
            set: { gapReason: reason, gapFromSlot, gapThroughSlot },
          });
      });
    },
    async owners(cluster: ActivityStream["cluster"]) {
      return db
        .select({
          artworkId: artworkOwnership.artworkId,
          assetAddress: artworkOwnership.assetAddress,
          ownerWallet: artworkOwnership.ownerWallet,
          sourceEventId: artworkOwnership.sourceEventId,
          slot: indexedEvents.slot,
        })
        .from(artworkOwnership)
        .innerJoin(indexedEvents, eq(indexedEvents.id, artworkOwnership.sourceEventId))
        .where(
          and(
            eq(artworkOwnership.cluster, cluster),
            inArray(indexedEvents.programAddress, [programs.registry, programs.core]),
          ),
        );
    },
    async reconcile(
      cluster: ActivityStream["cluster"],
      genesisHash: string,
      snapshot: { artworkId: string; sourceEventId: string; ownerWallet: string },
      observation: {
        slot: bigint;
        owner: string | null;
        status: "PRESENT" | "MISSING" | "INVALID";
      },
    ) {
      return db.transaction(async (tx) => {
        await tx.execute(lock(cluster));
        const [network] = await tx
          .select()
          .from(indexerNetworks)
          .where(
            and(
              eq(indexerNetworks.cluster, cluster),
              eq(indexerNetworks.registryProgram, programs.registry),
            ),
          );
        if (!network || network.blocked || network.genesisHash !== genesisHash)
          throw new Error("Indexer network unavailable");
        const [owner] = await tx
          .select()
          .from(artworkOwnership)
          .innerJoin(
            indexedEvents,
            eq(indexedEvents.id, artworkOwnership.sourceEventId),
          )
          .where(
            and(
              eq(artworkOwnership.cluster, cluster),
              eq(artworkOwnership.artworkId, snapshot.artworkId),
            ),
          )
          .for("share");
        if (
          !owner ||
          owner.artwork_ownership.sourceEventId !== snapshot.sourceEventId ||
          owner.artwork_ownership.ownerWallet !== snapshot.ownerWallet ||
          observation.slot < owner.indexed_events.slot ||
          observation.slot < network.finalizedSlot
        )
          return "STALE" as const;
        const [previous] = await tx
          .select()
          .from(ownershipReconciliations)
          .where(
            and(
              eq(ownershipReconciliations.cluster, cluster),
              eq(ownershipReconciliations.artworkId, snapshot.artworkId),
            ),
          );
        if (previous && previous.observedSlot > observation.slot)
          return "STALE" as const;
        if ((observation.status === "PRESENT") !== (observation.owner !== null))
          throw new Error("Invalid ownership observation");
        const status =
          observation.status === "PRESENT"
            ? observation.owner === snapshot.ownerWallet
              ? "MATCH"
              : "MISMATCH"
            : observation.status;
        await tx
          .insert(ownershipReconciliations)
          .values({
            cluster,
            artworkId: snapshot.artworkId,
            sourceEventId: snapshot.sourceEventId,
            indexedOwner: snapshot.ownerWallet,
            observedOwner: observation.owner,
            observedSlot: observation.slot,
            status,
          })
          .onConflictDoUpdate({
            target: [
              ownershipReconciliations.cluster,
              ownershipReconciliations.artworkId,
            ],
            set: {
              sourceEventId: snapshot.sourceEventId,
              indexedOwner: snapshot.ownerWallet,
              observedOwner: observation.owner,
              observedSlot: observation.slot,
              status,
            },
          });
        if (status !== "MATCH")
          await tx
            .update(indexerCheckpoints)
            .set({
              gapReason: "OWNER_MISMATCH",
              gapFromSlot: sql`coalesce(${indexerCheckpoints.gapFromSlot}, ${indexerCheckpoints.fromSlot})`,
              gapThroughSlot: sql`greatest(coalesce(${indexerCheckpoints.gapThroughSlot}, ${indexerCheckpoints.fromSlot}), ${observation.slot})`,
            })
            .where(
              and(
                eq(indexerCheckpoints.cluster, cluster),
                eq(indexerCheckpoints.programAddress, programs.core),
                sql`${indexerCheckpoints.gapReason} IS NULL OR ${indexerCheckpoints.gapReason} = 'OWNER_MISMATCH'`,
              ),
            );
        return status;
      });
    },
  };
}
export type IndexerRecoveryStore = ReturnType<typeof createIndexerRecoveryStore>;
