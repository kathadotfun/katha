import type { ArtworkDraftStore } from "@katha/db";
import {
  artworkDraftCreateRequestSchema,
  artworkDraftResponseSchema,
} from "@katha/shared";
import { DomainError } from "./errors.js";

export function createArtworkDrafts(store: ArtworkDraftStore) {
  return {
    async create(input: unknown) {
      const parsed = artworkDraftCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const data = parsed.data;
      const result = await store.create({
        creationRequestId: data.creationRequestId,
        artistId: data.artistId,
        category: data.category,
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
      return artworkDraftResponseSchema.parse({
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
    },
  };
}
export type ArtworkDraftsBoundary = ReturnType<typeof createArtworkDrafts>;
