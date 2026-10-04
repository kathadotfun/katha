import type { PublicArtworkDetailStore } from "@katha/db";
import { publicArtworkDetailSchema } from "@katha/shared";
import { DomainError } from "./errors.js";

function transaction(record: {
  chainSignature: string | null;
  chainSlot: bigint | null;
  chainRecordedAt: Date | null;
}) {
  return {
    signature: record.chainSignature,
    slot: record.chainSlot?.toString(),
    recordedAt: record.chainRecordedAt?.toISOString(),
  };
}
export function createArtworkDetails(store: PublicArtworkDetailStore) {
  return {
    async detail(kathaId: string) {
      const record = await store.findByKathaId(kathaId);
      if (!record) throw new DomainError("NOT_FOUND");
      const checkpoint = record.checkpoint;
      // Every nested projection is explicit; never return ORM records or indexed payloads.
      return publicArtworkDetailSchema.parse({
        kathaId: record.kathaId,
        category: record.category,
        title: record.title,
        creationYear: record.creationYear,
        artist: {
          id: record.artist.id,
          slug: record.artist.slug,
          displayName: record.artist.displayName,
        },
        creatorWallet: record.creatorWallet,
        dimensions:
          record.heightMm === null || record.widthMm === null
            ? null
            : {
                heightMm: record.heightMm,
                widthMm: record.widthMm,
                depthMm: record.depthMm,
              },
        origin: {
          countryCode: record.originCountryCode,
          region: record.originRegion,
          locality: record.originLocality,
        },
        technique: record.technique,
        story: record.story,
        meaning: record.meaning,
        culturalContext: record.culturalContext,
        creationProcess: record.creationProcess,
        materials: record.materials.map((material) => material.name),
        media: record.media.map((media) => ({
          id: media.id,
          kind: media.kind,
          role: media.role,
          position: media.position,
          contentHash: media.contentHash,
          mimeType: media.mimeType,
          altText: media.altText,
        })),
        verification: {
          status: "VERIFIED",
          verifierWallet: record.verification.authorityWallet,
          inspectedAt: record.verification.inspectedAt?.toISOString(),
          documentHash: record.verification.documentHash,
          transaction: transaction(record.verification),
        },
        metadata: {
          version: record.metadata.version,
          uri: record.metadata.uri,
          documentHash: record.metadata.documentHash,
          transaction: transaction(record.metadata),
        },
        condition: {
          version: record.condition.version,
          grade: record.condition.grade,
          reason: record.condition.reason,
          inspectedAt: record.condition.inspectedAt.toISOString(),
          verifierWallet: record.condition.authorityWallet,
          documentHash: record.condition.documentHash,
          transaction: transaction(record.condition),
        },
        custody: {
          state: record.custody?.state ?? "UNKNOWN",
          source: record.custody ? "MANUAL_OBSERVATION" : "UNKNOWN",
          observedAt: record.custody?.occurredAt.toISOString() ?? null,
        },
        ownership: {
          ownerWallet: record.ownership.ownerWallet,
          source: "INDEXED_CORE",
          observedAt: record.ownership.indexedAt.toISOString(),
          transaction: {
            signature: record.ownership.signature,
            slot: record.ownership.slot.toString(),
            recordedAt: record.ownership.chainRecordedAt.toISOString(),
          },
        },
        chain: {
          cluster: record.cluster,
          coreAssetAddress: record.ownership.assetAddress,
          // These bindings are not persisted yet. Never infer them from an arbitrary indexed payload.
          registryRecordAddress: null,
          collectionAddress: null,
        },
        indexing: {
          freshness: checkpoint?.gapFromSlot != null ? "GAP_DETECTED" : "UNKNOWN",
          checkpoint: checkpoint
            ? {
                programAddress: checkpoint.programAddress,
                scannedThroughSlot: checkpoint.scannedThroughSlot?.toString() ?? null,
                gapFromSlot: checkpoint.gapFromSlot?.toString() ?? null,
                gapThroughSlot: checkpoint.gapThroughSlot?.toString() ?? null,
                updatedAt: checkpoint.updatedAt.toISOString(),
              }
            : null,
        },
      });
    },
  };
}
export type ArtworkDetailsBoundary = ReturnType<typeof createArtworkDetails>;
