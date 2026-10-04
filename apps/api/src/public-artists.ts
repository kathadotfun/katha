import type { PublicArtistStore } from "@katha/db";
import {
  publicArtistSummarySchema,
  publicArtistDetailSchema,
  paginatedResponseSchema,
  type Pagination,
} from "@katha/shared";
import { DomainError } from "./errors.js";

type SummaryRecord = Awaited<ReturnType<PublicArtistStore["list"]>>[number];
function summary(record: SummaryRecord) {
  return publicArtistSummarySchema.parse({
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    region: record.region,
    traditions: record.traditions,
    profileImageUrl: record.profileImageUrl,
    verificationStatus: record.verificationStatus,
  });
}
const listSchema = paginatedResponseSchema(publicArtistSummarySchema);
export function createPublicArtists(store: PublicArtistStore) {
  return {
    async list(pagination: Pagination) {
      const records = await store.list(pagination);
      return listSchema.parse({
        items: records.slice(0, pagination.limit).map(summary),
        pagination: { ...pagination, hasMore: records.length > pagination.limit },
      });
    },
    async detail(slug: string) {
      const record = await store.findBySlug(slug);
      if (!record || record.verificationStatus !== "VERIFIED")
        throw new DomainError("NOT_FOUND");
      return publicArtistDetailSchema.parse({
        ...summary(record),
        biography: record.biography,
        publicLinks: record.publicLinks,
        creatorWallet: record.creatorWallet,
        verifiedAt: record.verifiedAt?.toISOString(),
        artworks: [],
      });
    },
  };
}
export type PublicArtistsBoundary = ReturnType<typeof createPublicArtists>;
