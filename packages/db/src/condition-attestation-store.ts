import { desc, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artworks } from "./schema/artworks.js";
import { artists } from "./schema/artists.js";
import { conditionReports } from "./schema/artwork-attestations.js";
import { createOperationPreparationStore } from "./operation-preparation-store.js";
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
async function snapshot(tx: Transaction, kathaId: string) {
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
  return { artwork, artist: artist ?? null, report: report ?? null };
}
export type ConditionAttestationSnapshot = NonNullable<
  Awaited<ReturnType<typeof snapshot>>
>;
export function createConditionAttestationStore(db: Database) {
  return {
    load: (kathaId: string) => db.transaction((tx) => snapshot(tx, kathaId)),
    operations(expected: ConditionAttestationSnapshot) {
      return createOperationPreparationStore(db, async (tx) => {
        const current = await snapshot(tx, expected.artwork.kathaId);
        return (
          current !== null &&
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
