import { and, asc, desc, eq } from "drizzle-orm";
import { finalizedCondition } from "./condition-write-guard.js";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artists } from "./schema/artists.js";
import { conditionReports } from "./schema/artwork-attestations.js";
import { artworkMedia } from "./schema/artwork-media.js";
import {
  blockchainOperations,
  transactionReceipts,
} from "./schema/blockchain-operations.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function snapshot(
  tx: Transaction,
  kathaId: string,
  cluster: "LOCALNET" | "DEVNET",
) {
  const [artwork] = await tx
    .select()
    .from(artworks)
    .where(eq(artworks.kathaId, kathaId))
    .for("share");
  if (!artwork) return null;
  const [artist] = await tx
    .select()
    .from(artists)
    .where(eq(artists.id, artwork.artistId))
    .for("share");
  const [report] = await tx
    .select()
    .from(conditionReports)
    .where(eq(conditionReports.artworkId, artwork.id))
    .orderBy(desc(conditionReports.version))
    .limit(1)
    .for("share");
  const media = await tx
    .select()
    .from(artworkMedia)
    .where(
      and(
        eq(artworkMedia.artworkId, artwork.id),
        eq(artworkMedia.role, "CONDITION"),
        eq(artworkMedia.kind, "IMAGE"),
        eq(artworkMedia.visibility, "PRIVATE"),
      ),
    )
    .orderBy(asc(artworkMedia.position));
  const [pending] = await tx
    .select({ id: transactionReceipts.id })
    .from(transactionReceipts)
    .innerJoin(
      blockchainOperations,
      eq(blockchainOperations.id, transactionReceipts.operationId),
    )
    .where(
      and(
        eq(blockchainOperations.artworkId, artwork.id),
        eq(blockchainOperations.kind, "RECORD_CONDITION"),
        eq(blockchainOperations.cluster, cluster),
        eq(transactionReceipts.cluster, cluster),
        eq(transactionReceipts.status, "UNKNOWN"),
      ),
    )
    .limit(1);
  const [finalized] = report?.documentHash
    ? await tx
        .select({
          attested: finalizedCondition(artwork.id, cluster, report.documentHash),
        })
        .from(artworks)
        .where(eq(artworks.id, artwork.id))
    : [];
  return {
    attested: Boolean(finalized?.attested),
    artwork,
    artist: artist ?? null,
    report: report ?? null,
    media,
    unresolved: Boolean(pending),
  };
}
export type ConditionAttestationSnapshot = NonNullable<
  Awaited<ReturnType<typeof snapshot>>
>;
export function createConditionAttestationStore(
  db: Database,
  cluster: "LOCALNET" | "DEVNET" = "LOCALNET",
) {
  return {
    load: (kathaId: string) => db.transaction((tx) => snapshot(tx, kathaId, cluster)),
    operations(expected: ConditionAttestationSnapshot) {
      return createOperationPreparationStore(db, async (tx) => {
        const current = await snapshot(tx, expected.artwork.kathaId, cluster);
        return (
          current !== null &&
          !current.unresolved &&
          !current.attested &&
          current.artist?.verificationStatus === "VERIFIED" &&
          current.artwork.id === expected.artwork.id &&
          current.artwork.updatedAt.toISOString() ===
            expected.artwork.updatedAt.toISOString() &&
          current.artwork.artistId === expected.artwork.artistId &&
          current.artwork.creatorWallet === expected.artwork.creatorWallet &&
          current.artwork.creationYear === expected.artwork.creationYear &&
          current.artwork.authorshipEvidenceHash ===
            expected.artwork.authorshipEvidenceHash &&
          current.report?.status === "PREPARED" &&
          current.report.id === expected.report?.id &&
          current.report.version === expected.report.version &&
          current.report.authorityWallet === expected.report.authorityWallet &&
          current.report.documentHash === expected.report.documentHash &&
          current.report.canonicalDocument === expected.report.canonicalDocument &&
          current.report.ownerWallet === expected.report.ownerWallet &&
          current.report.custodyRevision === expected.report.custodyRevision
        );
      });
    },
  };
}
export type ConditionAttestationStore = ReturnType<
  typeof createConditionAttestationStore
>;
