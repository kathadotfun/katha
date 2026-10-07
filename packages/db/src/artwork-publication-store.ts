import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { wallets } from "./schema/wallet-sessions.js";
import { conditionReports } from "./schema/artwork-attestations.js";
import {
  blockchainOperations,
  transactionReceipts,
} from "./schema/blockchain-operations.js";
import { indexedEvents, artworkOwnership } from "./schema/blockchain-read-models.js";
import { artists } from "./schema/artists.js";
import { loadArtworkRegistrationSnapshot } from "./artwork-registration-store.js";
import { publicationEligibilityPredicate } from "./public-artwork-store.js";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function review(
  tx: Transaction,
  kathaId: string,
  cluster: "LOCALNET" | "DEVNET",
) {
  const base = await loadArtworkRegistrationSnapshot(tx, kathaId, cluster);
  if (!base) return null;
  const [initialReport] = await tx
    .select()
    .from(conditionReports)
    .where(
      and(
        eq(conditionReports.artworkId, base.artwork.id),
        eq(conditionReports.reason, "INITIAL_VERIFICATION"),
        or(
          ne(conditionReports.status, "FINALIZED"),
          eq(conditionReports.chainCluster, cluster),
        ),
      ),
    )
    .orderBy(
      sql`case ${conditionReports.status} when 'FINALIZED' then 0 when 'PREPARED' then 1 else 2 end`,
      desc(conditionReports.version),
      desc(conditionReports.id),
    )
    .limit(1)
    .for("share");
  const [reservation] = await tx
    .select({
      idempotencyKey: blockchainOperations.idempotencyKey,
      walletAddress: wallets.address,
      status: blockchainOperations.status,
    })
    .from(blockchainOperations)
    .innerJoin(wallets, eq(wallets.id, blockchainOperations.walletId))
    .where(
      and(
        eq(blockchainOperations.artworkId, base.artwork.id),
        eq(blockchainOperations.cluster, cluster),
        eq(blockchainOperations.kind, "MINT_ARTWORK"),
        ne(blockchainOperations.status, "FAILED"),
      ),
    )
    .orderBy(desc(blockchainOperations.createdAt))
    .limit(1);
  const [ownership] = await tx
    .select()
    .from(artworkOwnership)
    .where(
      and(
        eq(artworkOwnership.artworkId, base.artwork.id),
        eq(artworkOwnership.cluster, cluster),
      ),
    )
    .for("share");
  const [indexedMint] = await tx
    .select({
      signature: transactionReceipts.signature,
      asset: indexedEvents.assetAddress,
    })
    .from(transactionReceipts)
    .innerJoin(
      blockchainOperations,
      eq(blockchainOperations.id, transactionReceipts.operationId),
    )
    .innerJoin(
      indexedEvents,
      and(
        eq(indexedEvents.signature, transactionReceipts.signature),
        eq(indexedEvents.cluster, cluster),
        eq(indexedEvents.artworkId, base.artwork.id),
        eq(indexedEvents.programAddress, blockchainOperations.programAddress),
        eq(indexedEvents.kind, "OWNERSHIP"),
        sql`${indexedEvents.payload}->>'name' = 'ArtworkMinted'`,
      ),
    )
    .where(
      and(
        eq(blockchainOperations.artworkId, base.artwork.id),
        eq(blockchainOperations.cluster, cluster),
        eq(blockchainOperations.kind, "MINT_ARTWORK"),
        eq(blockchainOperations.status, "FINALIZED"),
        eq(transactionReceipts.status, "FINALIZED"),
        eq(transactionReceipts.cluster, cluster),
      ),
    )
    .limit(1);
  const [unresolved] = await tx
    .select({ id: transactionReceipts.id })
    .from(transactionReceipts)
    .innerJoin(
      blockchainOperations,
      eq(blockchainOperations.id, transactionReceipts.operationId),
    )
    .where(
      and(
        eq(blockchainOperations.artworkId, base.artwork.id),
        eq(blockchainOperations.cluster, cluster),
        eq(blockchainOperations.kind, "MINT_ARTWORK"),
        eq(transactionReceipts.cluster, cluster),
        eq(transactionReceipts.status, "UNKNOWN"),
      ),
    )
    .limit(1);
  const [eligible] = await tx
    .select({ id: artworks.id })
    .from(artworks)
    .innerJoin(artists, eq(artists.id, artworks.artistId))
    .where(
      and(eq(artworks.id, base.artwork.id), publicationEligibilityPredicate(cluster)),
    );
  return {
    ...base,
    initialReport: initialReport ?? null,
    reservation: reservation ?? null,
    ownership: ownership ?? null,
    indexedMint: indexedMint ?? null,
    indexedEligible:
      !unresolved &&
      Boolean(eligible) &&
      base.metadata?.status === "FINALIZED" &&
      base.metadata.chainCluster === cluster &&
      initialReport?.status === "FINALIZED" &&
      initialReport.chainCluster === cluster,
  };
}
export function createArtworkPublicationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET",
) {
  return {
    review: (kathaId: string) => db.transaction((tx) => review(tx, kathaId, cluster)),
    async publish(
      expected: ArtworkPublicationSnapshot,
      binding: { asset: string; owner: string; signature: string },
    ) {
      return db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(artworks)
          .where(eq(artworks.id, expected.artwork.id))
          .for("update");
        if (
          !locked ||
          locked.updatedAt.toISOString() !== expected.artwork.updatedAt.toISOString()
        )
          return null;
        const current = await review(tx, locked.kathaId, cluster);
        if (
          !current ||
          !current.indexedEligible ||
          current.metadata?.id !== expected.metadata?.id ||
          current.metadata?.documentHash !== expected.metadata?.documentHash ||
          current.initialReport?.id !== expected.initialReport?.id ||
          current.initialReport?.documentHash !==
            expected.initialReport?.documentHash ||
          current.indexedMint?.signature !== binding.signature ||
          current.indexedMint.asset !== binding.asset ||
          current.ownership?.assetAddress !== binding.asset ||
          current.ownership.ownerWallet !== binding.owner
        )
          return null;
        if (current.artwork.publishedAt) return current.artwork;
        const [saved] = await tx
          .update(artworks)
          .set({
            publishedAt: sql`clock_timestamp()`,
            updatedAt: sql`greatest(clock_timestamp(), ${artworks.updatedAt} + interval '1 millisecond')`,
          })
          .where(eq(artworks.id, locked.id))
          .returning();
        return saved ?? null;
      });
    },
  };
}
export type ArtworkPublicationStore = ReturnType<typeof createArtworkPublicationStore>;
export type ArtworkPublicationSnapshot = NonNullable<
  Awaited<ReturnType<typeof review>>
>;
