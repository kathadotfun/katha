import type { ArtworkMediaBoundary } from "./artwork-media.js";
import type { ArtworkRecord, ArtworkDraftStore } from "@katha/db";
import {
  artworkDraftReadResponseSchema,
  artworkDraftListResponseSchema,
  type Pagination,
  artworkDraftCreateRequestSchema,
  artworkDraftResponseSchema,
  artworkDraftParamsSchema,
  artworkDraftUpdateRequestSchema,
} from "@katha/shared";
import { DomainError } from "./errors.js";

function response(record: ArtworkRecord, materials: string[] = []) {
  return artworkDraftResponseSchema.parse({
    materials,
    id: record.id,
    kathaId: record.kathaId,
    artistId: record.artistId,
    category: record.category,
    title: record.title,
    creationYear: record.creationYear,
    creatorWallet: record.creatorWallet,
    authorshipEvidenceHash: record.authorshipEvidenceHash,
    dimensions:
      record.heightMm === null
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
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

export function createArtworkDrafts(
  store: ArtworkDraftStore,
  media?: ArtworkMediaBoundary,
) {
  return {
    media,
    async read(kathaId: string) {
      const parsed = artworkDraftParamsSchema.safeParse({ kathaId });
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const found = await store.read(parsed.data.kathaId);
      if (!found) throw new DomainError("NOT_FOUND");
      return artworkDraftReadResponseSchema.parse({
        artwork: response(found.record, found.materials),
        editable: found.editable,
      });
    },
    async list(page: Pagination) {
      const rows = await store.list(page);
      return artworkDraftListResponseSchema.parse({
        items: rows.slice(0, page.limit).map((row) => ({
          id: row.id,
          kathaId: row.kathaId,
          category: row.category,
          title: row.title,
          creationYear: row.creationYear,
          artist: {
            id: row.artistId,
            displayName: row.artistName,
            verificationStatus: row.artistVerificationStatus,
          },
          workflowStatus: row.lifecycleStarted ? "LIFECYCLE_STARTED" : "DOCUMENTING",
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
        pagination: { ...page, hasMore: rows.length > page.limit },
      });
    },
    async update(kathaId: string, input: unknown) {
      const path = artworkDraftParamsSchema.safeParse({ kathaId });
      const parsed = artworkDraftUpdateRequestSchema.safeParse(input);
      if (!path.success || !parsed.success) throw new DomainError("INVALID_REQUEST");
      const data = parsed.data;
      const result = await store.update(path.data.kathaId, data.expectedUpdatedAt, {
        materials: data.materials,
        title: data.title,
        authorshipEvidenceHash: data.authorshipEvidenceHash,
        ...(data.dimensions !== undefined
          ? {
              heightMm: data.dimensions?.heightMm ?? null,
              widthMm: data.dimensions?.widthMm ?? null,
              depthMm: data.dimensions?.depthMm ?? null,
            }
          : {}),
        ...(data.origin !== undefined
          ? {
              originCountryCode: data.origin.countryCode,
              originRegion: data.origin.region ?? null,
              originLocality: data.origin.locality ?? null,
            }
          : {}),
        technique: data.technique,
        story: data.story,
        meaning: data.meaning,
        culturalContext: data.culturalContext,
        creationProcess: data.creationProcess,
      });
      if (result.status === "not_found") throw new DomainError("NOT_FOUND");
      if (result.status !== "updated") throw new DomainError("CONFLICT");
      return response(result.record, result.materials);
    },
    async create(input: unknown) {
      const parsed = artworkDraftCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const data = parsed.data;
      const result = await store.create({
        creationRequestId: data.creationRequestId,
        artistId: data.artistId,
        category: data.category,
        materials: data.materials,
        title: data.title,
        creationYear: data.creationYear,
        authorshipEvidenceHash: data.authorshipEvidenceHash ?? null,
        heightMm: data.dimensions?.heightMm ?? null,
        widthMm: data.dimensions?.widthMm ?? null,
        depthMm: data.dimensions?.depthMm ?? null,
        originCountryCode: data.origin?.countryCode ?? "NP",
        originRegion: data.origin?.region ?? null,
        originLocality: data.origin?.locality ?? null,
        technique: data.technique ?? null,
        story: data.story ?? null,
        meaning: data.meaning ?? null,
        culturalContext: data.culturalContext ?? null,
        creationProcess: data.creationProcess ?? null,
      });
      if (result.status === "artist_not_found") throw new DomainError("NOT_FOUND");
      if (result.status !== "created") throw new DomainError("CONFLICT");
      const record = result.record;
      return response(record, result.materials);
    },
  };
}
export type ArtworkDraftsBoundary = ReturnType<typeof createArtworkDrafts>;
