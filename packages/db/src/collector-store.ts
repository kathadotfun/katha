import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { publicationPredicate } from "./public-artwork-store.js";
import {
  artworks,
  artists,
  artworkMedia,
  artworkOwnership,
  indexedEvents,
  indexerCheckpoints,
  indexerNetworks,
  ownershipReconciliations,
} from "./schema/index.js";

type Programs = { registry: string; core: string; marketplace: string };
/** Read-only collector scope. Never selects private evidence or fulfillment fields. */
export function createCollectorStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
  programs: Programs,
) {
  const scope = (wallet: string) =>
    and(
      publicationPredicate(cluster),
      eq(artworkOwnership.cluster, cluster),
      eq(artworkOwnership.ownerWallet, wallet),
      inArray(indexedEvents.programAddress, [
        programs.registry,
        programs.core,
        programs.marketplace,
      ]),
    );
  return {
    async account(wallet: string) {
      const [row] = await db
        .select({
          count: sql<string>`count(*)::text`,
          evaluatedAt: sql<string>`transaction_timestamp()::text`,
        })
        .from(artworks)
        .innerJoin(artists, eq(artists.id, artworks.artistId))
        .innerJoin(artworkOwnership, eq(artworkOwnership.artworkId, artworks.id))
        .innerJoin(indexedEvents, eq(indexedEvents.id, artworkOwnership.sourceEventId))
        .where(scope(wallet));
      return {
        indexedArtworkCount: Number(row!.count),
        evaluatedAt: new Date(row!.evaluatedAt),
      };
    },
    async collection(wallet: string, query: { limit: number; offset: number }) {
      return db.transaction(
        async (tx) => {
          const records = await tx
            .select({
              artwork: {
                kathaId: artworks.kathaId,
                category: artworks.category,
                title: artworks.title,
                creationYear: artworks.creationYear,
              },
              artist: {
                id: artists.id,
                slug: artists.slug,
                displayName: artists.displayName,
              },
              heroImage: {
                id: artworkMedia.id,
                contentHash: artworkMedia.contentHash,
                mimeType: artworkMedia.mimeType,
                altText: artworkMedia.altText,
              },
              owner: artworkOwnership,
              ownershipEvent: indexedEvents,
              reconciliation: ownershipReconciliations,
            })
            .from(artworks)
            .innerJoin(artists, eq(artists.id, artworks.artistId))
            .innerJoin(artworkOwnership, eq(artworkOwnership.artworkId, artworks.id))
            .innerJoin(
              indexedEvents,
              eq(indexedEvents.id, artworkOwnership.sourceEventId),
            )
            .leftJoin(
              ownershipReconciliations,
              and(
                eq(ownershipReconciliations.artworkId, artworks.id),
                eq(ownershipReconciliations.cluster, cluster),
              ),
            )
            .leftJoin(
              artworkMedia,
              and(
                eq(artworkMedia.artworkId, artworks.id),
                eq(artworkMedia.role, "HERO"),
                eq(artworkMedia.kind, "IMAGE"),
                eq(artworkMedia.visibility, "PUBLIC"),
              ),
            )
            .where(scope(wallet))
            .orderBy(asc(artworks.kathaId))
            .limit(query.limit + 1)
            .offset(query.offset);
          const [network] = await tx
            .select()
            .from(indexerNetworks)
            .where(
              and(
                eq(indexerNetworks.cluster, cluster),
                eq(indexerNetworks.registryProgram, programs.registry),
              ),
            );
          const checkpoints = await tx
            .select()
            .from(indexerCheckpoints)
            .where(
              and(
                eq(indexerCheckpoints.cluster, cluster),
                inArray(indexerCheckpoints.programAddress, [
                  programs.registry,
                  programs.core,
                  programs.marketplace,
                ]),
              ),
            );
          const [clock] = await tx.execute<{ time: string }>(
            sql`select transaction_timestamp()::text as time`,
          );
          const evaluatedAt = new Date(clock!.time);
          const items = [];
          for (const record of records) {
            const eventScope = and(
              eq(indexedEvents.cluster, cluster),
              eq(indexedEvents.artworkId, record.owner.artworkId),
              eq(indexedEvents.programAddress, programs.registry),
            );
            const latest = async (name: string) =>
              (
                await tx
                  .select()
                  .from(indexedEvents)
                  .where(
                    and(eventScope, sql`${indexedEvents.payload}->>'name' = ${name}`),
                  )
                  .orderBy(
                    desc(indexedEvents.slot),
                    desc(indexedEvents.transactionIndex),
                    desc(indexedEvents.outerInstructionIndex),
                    desc(indexedEvents.innerInstructionIndex),
                    desc(indexedEvents.eventIndex),
                  )
                  .limit(1)
              )[0] ?? null;
            const [registration, mint, custody] = await Promise.all([
              latest("ArtworkRegistered"),
              latest("ArtworkMinted"),
              latest("CustodyUpdated"),
            ]);
            items.push({
              ...record,
              registration,
              mint,
              custody,
              network: network ?? null,
              checkpoints,
              evaluatedAt,
              programs,
            });
          }
          return { items, evaluatedAt };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
export type CollectorStore = ReturnType<typeof createCollectorStore>;
