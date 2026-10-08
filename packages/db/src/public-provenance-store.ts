import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { publicationPredicate } from "./public-artwork-store.js";
import {
  artworks,
  artists,
  indexedEvents,
  indexerCheckpoints,
  artworkOwnership,
  indexerNetworks,
  ownershipReconciliations,
  artworkSales,
  artworkListings,
  conditionReports,
  artworkMedia,
} from "./schema/index.js";

const names = {
  REGISTRATION: "ArtworkRegistered",
  VERIFICATION: "ArtworkVerified",
  METADATA: "MetadataCommitted",
  CONDITION: "ConditionRecorded",
  CUSTODY: "CustodyUpdated",
  MINT: "ArtworkMinted",
  TRANSFER: "CoreTransfer",
} as const;
export function createPublicProvenanceStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
  programs: { registry: string; core: string; marketplace?: string },
) {
  return {
    async find(
      kathaId: string,
      query: { limit: number; offset: number; type?: keyof typeof names | undefined },
    ) {
      return db.transaction(
        async (tx) => {
          const [record] = await tx
            .select({
              id: artworks.id,
              kathaId: artworks.kathaId,
              category: artworks.category,
              creationYear: artworks.creationYear,
              creatorWallet: artworks.creatorWallet,
              authorshipEvidenceHash: artworks.authorshipEvidenceHash,
              artist: {
                id: artists.id,
                slug: artists.slug,
                displayName: artists.displayName,
              },
            })
            .from(artworks)
            .innerJoin(artists, eq(artists.id, artworks.artistId))
            .where(and(publicationPredicate(cluster), eq(artworks.kathaId, kathaId)))
            .limit(1);
          if (!record) return null;
          const scope = and(
            eq(indexedEvents.cluster, cluster),
            eq(indexedEvents.artworkId, record.id),
            inArray(indexedEvents.programAddress, [programs.registry, programs.core]),
          );
          const order = [
            asc(indexedEvents.slot),
            asc(indexedEvents.transactionIndex),
            asc(indexedEvents.outerInstructionIndex),
            asc(indexedEvents.innerInstructionIndex),
            asc(indexedEvents.eventIndex),
            asc(indexedEvents.id),
          ];
          // Payload remains internal. The HTTP boundary whitelists and validates each public field.
          const events = await tx
            .select()
            .from(indexedEvents)
            .where(
              and(
                scope,
                query.type
                  ? sql`${indexedEvents.payload}->>'name' = ${names[query.type]}`
                  : undefined,
              ),
            )
            .orderBy(...order)
            .limit(query.limit + 1)
            .offset(query.offset);
          const pageEvents = events.slice(0, query.limit);
          const signatures = pageEvents
            .filter((e) => e.payload.name === "CoreTransfer")
            .map((e) => e.signature);
          const sales =
            signatures.length && programs.marketplace
              ? await tx
                  .select({
                    sale: artworkSales,
                    event: indexedEvents,
                    listing: artworkListings,
                  })
                  .from(artworkSales)
                  .innerJoin(
                    indexedEvents,
                    eq(indexedEvents.id, artworkSales.sourceEventId),
                  )
                  .innerJoin(
                    artworkListings,
                    eq(artworkListings.id, artworkSales.listingId),
                  )
                  .where(
                    and(
                      eq(artworkSales.artworkId, record.id),
                      eq(artworkSales.cluster, cluster),
                      eq(indexedEvents.programAddress, programs.marketplace),
                      inArray(indexedEvents.signature, signatures),
                    ),
                  )
              : [];
          const versions = pageEvents
            .filter((e) => e.payload.name === "ConditionRecorded")
            .map((e) => Number(e.payload.version))
            .filter(Number.isSafeInteger);
          const reports = versions.length
            ? await tx
                .select()
                .from(conditionReports)
                .where(
                  and(
                    eq(conditionReports.artworkId, record.id),
                    eq(conditionReports.status, "FINALIZED"),
                    eq(conditionReports.chainCluster, cluster),
                    inArray(conditionReports.chainVersion, versions),
                    inArray(
                      conditionReports.documentHash,
                      pageEvents
                        .filter((e) => e.payload.name === "ConditionRecorded")
                        .map((e) => String(e.payload.reportHash)),
                    ),
                  ),
                )
            : [];
          const mediaHashes = [...new Set(reports.flatMap((r) => r.mediaHashes))];
          // Public visibility is checked now, even for older reports. Private media is never returned.
          const inspectionMedia = mediaHashes.length
            ? await tx
                .select({
                  contentHash: artworkMedia.contentHash,
                  mimeType: artworkMedia.mimeType,
                  altText: artworkMedia.altText,
                })
                .from(artworkMedia)
                .where(
                  and(
                    eq(artworkMedia.artworkId, record.id),
                    eq(artworkMedia.visibility, "PUBLIC"),
                    eq(artworkMedia.kind, "IMAGE"),
                    inArray(artworkMedia.contentHash, mediaHashes),
                  ),
                )
            : [];
          const [registration] = await tx
            .select()
            .from(indexedEvents)
            .where(
              and(
                scope,
                eq(indexedEvents.programAddress, programs.registry),
                sql`${indexedEvents.payload}->>'name' = 'ArtworkRegistered'`,
              ),
            )
            .orderBy(...order)
            .limit(1);
          const [mint] = await tx
            .select()
            .from(indexedEvents)
            .where(
              and(
                scope,
                eq(indexedEvents.programAddress, programs.registry),
                sql`${indexedEvents.payload}->>'name' = 'ArtworkMinted'`,
              ),
            )
            .orderBy(...order)
            .limit(1);
          const checkpoints = await tx
            .select()
            .from(indexerCheckpoints)
            .where(
              and(
                eq(indexerCheckpoints.cluster, cluster),
                inArray(indexerCheckpoints.programAddress, [
                  programs.registry,
                  programs.core,
                  ...(programs.marketplace ? [programs.marketplace] : []),
                ]),
              ),
            );
          const [network] = await tx
            .select()
            .from(indexerNetworks)
            .where(
              and(
                eq(indexerNetworks.cluster, cluster),
                eq(indexerNetworks.registryProgram, programs.registry),
              ),
            )
            .limit(1);
          const [owner] = await tx
            .select()
            .from(artworkOwnership)
            .where(
              and(
                eq(artworkOwnership.cluster, cluster),
                eq(artworkOwnership.artworkId, record.id),
              ),
            )
            .limit(1);
          const [reconciliation] = await tx
            .select()
            .from(ownershipReconciliations)
            .where(
              and(
                eq(ownershipReconciliations.cluster, cluster),
                eq(ownershipReconciliations.artworkId, record.id),
              ),
            )
            .limit(1);
          const [clock] = await tx
            .select({
              time: sql<string>`transaction_timestamp()::text`,
            })
            .from(artworks)
            .where(eq(artworks.id, record.id))
            .limit(1);
          return {
            ...record,
            events,
            sales,
            reports,
            inspectionMedia,
            registration: registration ?? null,
            mint: mint ?? null,
            checkpoints,
            network: network ?? null,
            owner: owner ?? null,
            reconciliation: reconciliation ?? null,
            evaluatedAt: new Date(clock!.time),
            cluster,
            programs,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
export type PublicProvenanceStore = ReturnType<typeof createPublicProvenanceStore>;
