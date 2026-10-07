import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import type { StoredActivity } from "./activity-store.js";
import {
  artworkMetadataVersions,
  conditionReports,
  verifications,
} from "./schema/artwork-attestations.js";
import { artworks } from "./schema/artworks.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const conflict = () => new Error("Activity attestation conflict");
function seconds(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw conflict();
  const date = new Date(Number(value) * 1000);
  if (!Number.isSafeInteger(date.getTime())) throw conflict();
  return date;
}
function uuid(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{32}$/.test(value)) throw conflict();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
/** Project only finalized, validated Registry evidence, in the event/checkpoint transaction. */
export async function projectActivityAttestations(
  tx: Transaction,
  cluster: "LOCALNET" | "DEVNET",
  artworkId: string,
  event: StoredActivity,
) {
  const p = event.payload;
  const now = new Date(Math.max(Date.now(), event.chainRecordedAt.getTime()));
  const receipt = {
    status: "FINALIZED" as const,
    chainCluster: cluster,
    chainSignature: event.signature,
    chainSlot: event.slot,
    chainRecordedAt: event.chainRecordedAt,
    finalizedAt: now,
    updatedAt: now,
  };
  const sameReceipt = (row: {
    chainCluster: string | null;
    chainSignature: string | null;
    chainSlot: bigint | null;
  }) =>
    row.chainCluster === cluster &&
    row.chainSignature === event.signature &&
    row.chainSlot === event.slot;
  if (p.name === "ArtworkVerified") {
    const [artwork] = await tx
      .select()
      .from(artworks)
      .where(eq(artworks.id, artworkId));
    if (
      !artwork ||
      p.authorshipEvidenceHash !== artwork.authorshipEvidenceHash ||
      typeof p.verifier !== "string"
    )
      throw conflict();
    const [existing] = await tx
      .select()
      .from(verifications)
      .where(
        and(
          eq(verifications.artworkId, artworkId),
          eq(verifications.status, "FINALIZED"),
        ),
      );
    if (existing) {
      if (
        !sameReceipt(existing) ||
        existing.evidenceHash !== p.authorshipEvidenceHash ||
        existing.authorityWallet !== p.verifier
      )
        throw conflict();
      return;
    }
    const inspectedAt = seconds(p.verifiedAt);
    // This public document records the on-chain attestation, never private inspection notes.
    const canonicalDocument = JSON.stringify({
      evidenceHash: artwork.authorshipEvidenceHash,
      inspectedAt: inspectedAt.toISOString(),
      kathaId: artwork.kathaId,
      notes: null,
      verifierWallet: p.verifier,
    });
    const [prepared] = await tx
      .insert(verifications)
      .values({
        artworkId,
        status: "PREPARED",
        authorityWallet: p.verifier,
        evidenceHash: artwork.authorshipEvidenceHash!,
        inspectedAt,
        canonicalDocument,
        documentHash: createHash("sha256").update(canonicalDocument).digest("hex"),
        updatedAt: now,
      })
      .returning();
    if (!prepared) throw conflict();
    await tx
      .update(verifications)
      .set(receipt)
      .where(eq(verifications.id, prepared.id));
  } else if (p.name === "MetadataCommitted") {
    const [row] = await tx
      .select()
      .from(artworkMetadataVersions)
      .where(
        and(
          eq(artworkMetadataVersions.artworkId, artworkId),
          eq(artworkMetadataVersions.documentHash, String(p.documentHash)),
        ),
      )
      .for("update");
    // External chain documents are not invented or published by the indexer.
    if (!row || event.metadataUri === undefined) return;
    if (
      row.uri !== event.metadataUri ||
      row.authorityWallet !== p.committedBy ||
      !Number.isInteger(p.version) ||
      Number(p.version) < 1
    )
      throw conflict();
    if (row.status === "FINALIZED") {
      if (!sameReceipt(row) || row.chainVersion !== p.version) throw conflict();
      return;
    }
    if (row.status !== "PREPARED") throw conflict();
    await tx
      .update(artworkMetadataVersions)
      .set({ ...receipt, chainVersion: Number(p.version) })
      .where(eq(artworkMetadataVersions.id, row.id));
  } else if (p.name === "ConditionRecorded") {
    const [row] = await tx
      .select()
      .from(conditionReports)
      .where(
        and(
          eq(conditionReports.artworkId, artworkId),
          eq(conditionReports.id, uuid(p.reportId)),
        ),
      )
      .for("update");
    if (!row) return;
    const grades = ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"];
    const reasons = [
      "INITIAL_VERIFICATION",
      "PRE_SALE",
      "POST_DELIVERY",
      "PRE_RESALE",
      "RETURN_TO_CUSTODY",
      "INSURANCE",
    ];
    // Integer-second instruction timestamps deliberately truncate document milliseconds.
    const option = (value: unknown) =>
      value !== null &&
      typeof value === "object" &&
      "__option" in value &&
      value.__option === "Some" &&
      "value" in value
        ? value.value
        : null;
    if (
      row.documentHash !== p.reportHash ||
      row.authorityWallet !== p.verifier ||
      row.inspectorId !== uuid(p.inspectorId) ||
      grades[Number(p.grade)] !== row.grade ||
      reasons[Number(p.reason)] !== row.reason ||
      Math.floor(row.inspectedAt.getTime() / 1000) !==
        seconds(p.inspectedAt).getTime() / 1000 ||
      row.ownerWallet !== option(p.ownerScope) ||
      (row.custodyRevision === null ? null : String(row.custodyRevision)) !==
        option(p.custodyRevisionScope) ||
      !Number.isInteger(p.version) ||
      Number(p.version) < 1
    )
      throw conflict();
    if (row.status === "FINALIZED") {
      if (!sameReceipt(row) || row.chainVersion !== p.version) throw conflict();
      return;
    }
    if (row.status !== "PREPARED") throw conflict();
    await tx
      .update(conditionReports)
      .set({ ...receipt, chainVersion: Number(p.version) })
      .where(eq(conditionReports.id, row.id));
  }
}
