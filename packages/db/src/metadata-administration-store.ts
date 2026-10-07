import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artworkMetadataVersions } from "./schema/artwork-attestations.js";
import {
  loadArtworkRegistrationSnapshot,
  type ArtworkRegistrationSnapshot,
} from "./artwork-registration-store.js";
import { unresolvedMetadata } from "./metadata-write-guard.js";
export function createMetadataAdministrationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return {
    async current(kathaId: string) {
      const [row] = await db
        .select({ metadata: artworkMetadataVersions })
        .from(artworkMetadataVersions)
        .innerJoin(artworks, eq(artworks.id, artworkMetadataVersions.artworkId))
        .where(
          and(
            eq(artworks.kathaId, kathaId),
            eq(artworkMetadataVersions.status, "FINALIZED"),
            eq(artworkMetadataVersions.chainCluster, cluster),
          ),
        )
        .orderBy(desc(artworkMetadataVersions.chainVersion))
        .limit(1);
      return row?.metadata ?? null;
    },
    async save(
      expected: ArtworkRegistrationSnapshot,
      authorityWallet: string,
      build: () => Promise<{
        canonicalDocument: string;
        documentHash: string;
        uri: string;
      }>,
    ) {
      return db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, expected.artwork.id))
          .for("update");
        if (!parent) return false;
        const current = await loadArtworkRegistrationSnapshot(
          tx,
          parent.kathaId,
          cluster,
        );
        if (
          !current ||
          current.artist?.verificationStatus !== "VERIFIED" ||
          current.artwork.updatedAt.toISOString() !==
            expected.artwork.updatedAt.toISOString() ||
          current.metadata?.id !== expected.metadata?.id ||
          current.metadata?.documentHash !== expected.metadata?.documentHash ||
          current.metadata?.canonicalDocument !== expected.metadata?.canonicalDocument
        )
          return false;
        const [guard] = await tx
          .select({ blocked: unresolvedMetadata(parent.id, cluster) })
          .from(artworks)
          .where(eq(artworks.id, parent.id));
        if (
          guard?.blocked ||
          !current.metadata ||
          current.metadata.version >= 4294967295
        )
          return false;
        const next = await build();
        if (next.documentHash === current.metadata.documentHash) return false;
        await tx.insert(artworkMetadataVersions).values({
          artworkId: parent.id,
          authorityWallet,
          status: "PREPARED",
          version: current.metadata.version + 1,
          ...next,
        });
        await tx
          .update(artworks)
          .set({
            updatedAt: sql`greatest(clock_timestamp(), ${artworks.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(artworks.id, parent.id));
        return true;
      });
    },
  };
}
export type MetadataAdministrationStore = ReturnType<
  typeof createMetadataAdministrationStore
>;
