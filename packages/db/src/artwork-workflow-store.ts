import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artworkMedia } from "./schema/artwork-media.js";
import { artworkMetadataVersions } from "./schema/artwork-attestations.js";
import { blockchainOperations } from "./schema/blockchain-operations.js";

const tracked = [
  "REGISTER_ARTWORK",
  "VERIFY_ARTWORK",
  "RECORD_CONDITION",
  "UPDATE_CUSTODY",
  "MINT_ARTWORK",
  "REVISE_METADATA",
] as const;
export type WorkflowOperationKind = (typeof tracked)[number];

// One snapshot of the facts behind the workspace tab markers.
export function createArtworkWorkflowStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return {
    async read(kathaId: string) {
      return db.transaction(async (tx) => {
        const [artwork] = await tx
          .select({
            id: artworks.id,
            evidence: artworks.authorshipEvidenceHash,
            publishedAt: artworks.publishedAt,
          })
          .from(artworks)
          .where(eq(artworks.kathaId, kathaId));
        if (!artwork) return null;
        const operations = await tx
          .select({
            kind: blockchainOperations.kind,
            finalized:
              sql<boolean>`bool_or(${blockchainOperations.status} = 'FINALIZED')`.mapWith(
                Boolean,
              ),
            open: sql<boolean>`bool_or(${blockchainOperations.status} in ('PREPARED', 'UNKNOWN'))`.mapWith(
              Boolean,
            ),
          })
          .from(blockchainOperations)
          .where(
            and(
              eq(blockchainOperations.artworkId, artwork.id),
              eq(blockchainOperations.cluster, cluster),
            ),
          )
          .groupBy(blockchainOperations.kind);
        const [media] = await tx
          .select({
            any: sql<boolean>`count(*) > 0`.mapWith(Boolean),
            hero: sql<boolean>`bool_or(${artworkMedia.role} = 'HERO' and ${artworkMedia.kind} = 'IMAGE' and ${artworkMedia.visibility} = 'PUBLIC')`.mapWith(
              Boolean,
            ),
          })
          .from(artworkMedia)
          .where(eq(artworkMedia.artworkId, artwork.id));
        const [documents] = await tx
          .select({ any: sql<boolean>`count(*) > 0`.mapWith(Boolean) })
          .from(artworkMetadataVersions)
          .where(eq(artworkMetadataVersions.artworkId, artwork.id));
        return {
          hasEvidence: artwork.evidence !== null,
          published: artwork.publishedAt !== null,
          media: { any: media?.any ?? false, publicHero: media?.hero ?? false },
          hasMetadataDocument: documents?.any ?? false,
          operations: Object.fromEntries(
            operations
              .filter((row): row is typeof row & { kind: WorkflowOperationKind } =>
                (tracked as readonly string[]).includes(row.kind),
              )
              .map((row) => [row.kind, { finalized: row.finalized, open: row.open }]),
          ) as Partial<
            Record<WorkflowOperationKind, { finalized: boolean; open: boolean }>
          >,
        };
      });
    },
  };
}
export type ArtworkWorkflowStore = ReturnType<typeof createArtworkWorkflowStore>;
