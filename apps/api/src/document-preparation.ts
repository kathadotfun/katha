import type { DocumentPreparationStore } from "@katha/db";
import {
  artworkSchema,
  canonicalDocumentBytes,
  sha256Hex,
  metadataDocumentSchema,
  metadataPreparationRequestSchema,
  conditionPreparationRequestSchema,
  conditionReportDocumentSchema,
  preparedDocumentResponseSchema,
  type WalletSession,
} from "@katha/shared";
import {
  type StorageProvider,
  type StoredObject,
  storedObjectSchema,
} from "./storage.js";
import { DomainError } from "./errors.js";

type Snapshot = Parameters<Parameters<DocumentPreparationStore["prepare"]>[4]>[0];
export function createDocumentPreparation(
  store: DocumentPreparationStore,
  storage: StorageProvider,
  publicApiOrigin: string,
) {
  function url(reference: StoredObject) {
    return `${publicApiOrigin}/storage/${reference.storageKey}`;
  }
  async function mediaBytes(media: Snapshot["media"][number]) {
    const parsed = storedObjectSchema.safeParse({
      storageKey: media.storageKey,
      contentHash: media.contentHash,
      mimeType: media.mimeType,
      byteSize: media.byteSize.toString(),
      visibility: media.visibility,
    });
    if (!parsed.success) throw new DomainError("CONFLICT");
    const bytes = await storage.read(parsed.data);
    if ((await sha256Hex(bytes)) !== media.contentHash)
      throw new DomainError("CONFLICT");
    return parsed.data;
  }
  async function persist(bytes: Uint8Array, visibility: "PUBLIC" | "PRIVATE") {
    const documentHash = await sha256Hex(bytes);
    const reference = await storage.put({
      bytes,
      mimeType: "application/json",
      visibility,
    });
    if (
      reference.contentHash !== documentHash ||
      reference.visibility !== visibility ||
      reference.byteSize !== String(bytes.length)
    )
      throw new DomainError("CONFLICT");
    // Read-back verifies a replacement provider persisted the exact bytes it acknowledged.
    const stored = await storage.read(reference);
    if ((await sha256Hex(stored)) !== documentHash) throw new DomainError("CONFLICT");
    return {
      canonicalDocument: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      documentHash,
      uri: visibility === "PUBLIC" ? url(reference) : null,
    };
  }
  return {
    async metadata(kathaId: string, input: unknown, session: WalletSession) {
      const request = metadataPreparationRequestSchema.safeParse(input);
      if (!request.success) throw new DomainError("INVALID_REQUEST");
      const result = await store.prepare(
        kathaId,
        request.data.expectedUpdatedAt,
        session.walletAddress,
        "METADATA",
        async (snapshot) => {
          const a = snapshot.artwork;
          const parsed = artworkSchema.safeParse({
            kathaId: a.kathaId,
            category: a.category,
            title: a.title,
            attribution: {
              artistId: a.artistId,
              displayName: snapshot.artist.displayName,
              creatorWallet: a.creatorWallet,
            },
            authorshipEvidenceHash: a.authorshipEvidenceHash,
            creationYear: a.creationYear,
            origin: {
              countryCode: a.originCountryCode,
              region: a.originRegion,
              locality: a.originLocality,
            },
            dimensions: {
              heightMm: a.heightMm,
              widthMm: a.widthMm,
              depthMm: a.depthMm,
            },
            materials: snapshot.materials.map((row) => row.name),
            technique: a.technique,
            publicContent: {
              story: a.story,
              meaning: a.meaning,
              culturalContext: a.culturalContext,
              creationProcess: a.creationProcess,
            },
          });
          if (!parsed.success) throw new DomainError("CONFLICT");
          const artwork = parsed.data;
          const approved = snapshot.media.filter(
            (media) => media.visibility === "PUBLIC",
          );
          if (approved.length === 0 || approved.length > 100)
            throw new DomainError("CONFLICT");
          const media = [];
          for (const row of approved) {
            const ref = await mediaBytes(row);
            media.push({
              contentHash: ref.contentHash,
              mimeType: ref.mimeType,
              role: row.role,
              uri: url(ref),
            });
          }
          const hero = approved.findIndex(
            (row) => row.role === "HERO" && row.kind === "IMAGE",
          );
          if (hero < 0) throw new DomainError("CONFLICT");
          const document = metadataDocumentSchema.parse({
            schemaVersion: 1,
            kathaId: artwork.kathaId,
            name: artwork.title,
            category: artwork.category,
            artist: artwork.attribution,
            creationYear: artwork.creationYear,
            origin: artwork.origin,
            dimensions: artwork.dimensions,
            materials: artwork.materials,
            technique: artwork.technique,
            publicContent: artwork.publicContent,
            image: media[hero]!.uri,
            media,
          });
          const prepared = await persist(canonicalDocumentBytes(document), "PUBLIC");
          if (
            prepared.uri === null ||
            new TextEncoder().encode(prepared.uri).length > 200
          )
            throw new DomainError("CONFLICT");
          return prepared;
        },
      );
      if (result.status !== "prepared")
        throw new DomainError(result.status === "not_found" ? "NOT_FOUND" : "CONFLICT");
      return preparedDocumentResponseSchema.parse({
        id: result.record.id,
        kathaId,
        version: result.record.version,
        status: "PREPARED",
        documentHash: result.record.documentHash,
        uri: "uri" in result.record ? result.record.uri : null,
      });
    },
    async condition(kathaId: string, input: unknown, session: WalletSession) {
      const request = conditionPreparationRequestSchema.safeParse(input);
      if (!request.success) throw new DomainError("INVALID_REQUEST");
      const data = request.data;
      const result = await store.prepare(
        kathaId,
        data.expectedUpdatedAt,
        session.walletAddress,
        "CONDITION",
        async (snapshot) => {
          const hashes = [];
          for (const id of data.mediaIds) {
            const media = snapshot.media.find((row) => row.id === id);
            if (!media || media.role !== "CONDITION" || media.kind !== "IMAGE")
              throw new DomainError("CONFLICT");
            const ref = await mediaBytes(media);
            hashes.push(ref.contentHash);
          }
          const parsed = conditionReportDocumentSchema.safeParse({
            reportId: data.reportId,
            kathaId,
            inspectorId: data.inspectorId,
            verifierWallet: session.walletAddress,
            grade: data.grade,
            reason: data.reason,
            inspectedAt: data.inspectedAt,
            reportedAt: data.reportedAt,
            notes: data.notes,
            mediaHashes: hashes,
          });
          if (!parsed.success || new Date(data.reportedAt).getTime() > Date.now())
            throw new DomainError("INVALID_REQUEST");
          const document = parsed.data;
          const prepared = await persist(canonicalDocumentBytes(document), "PRIVATE");
          return {
            ...prepared,
            condition: {
              id: document.reportId,
              inspectorId: document.inspectorId,
              grade: document.grade,
              reason: document.reason,
              inspectedAt: new Date(document.inspectedAt),
              reportedAt: new Date(document.reportedAt),
              notes: document.notes,
              mediaHashes: document.mediaHashes,
            },
          };
        },
      );
      if (result.status !== "prepared")
        throw new DomainError(result.status === "not_found" ? "NOT_FOUND" : "CONFLICT");
      return preparedDocumentResponseSchema.parse({
        id: result.record.id,
        kathaId,
        version: result.record.version,
        status: "PREPARED",
        documentHash: result.record.documentHash,
        uri: null,
      });
    },
  };
}
export type DocumentPreparationBoundary = ReturnType<typeof createDocumentPreparation>;
