import type { ArtistRecord, ArtistStore } from "@katha/db";
import {
  artistCreateRequestSchema,
  artistIdParamsSchema,
  artistResponseSchema,
  artistSearchResponseSchema,
  type ArtistSearchQuery,
  artistVerificationRequestSchema,
  type WalletSession,
} from "@katha/shared";
import { validateWalletAddress } from "@katha/solana";
import { DomainError } from "./errors.js";

function response(record: ArtistRecord) {
  // Deliberate projection: future private storage columns never leak by spread.
  return artistResponseSchema.parse({
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    biography: record.biography,
    region: record.region,
    traditions: record.traditions,
    publicLinks: record.publicLinks,
    profileImageUrl: record.profileImageUrl,
    creatorWallet: record.creatorWallet,
    payoutWallet: record.payoutWallet,
    verificationStatus: record.verificationStatus,
    verifiedByWallet: record.verifiedByWallet,
    verifiedAt: record.verifiedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}
export function createArtists(store: ArtistStore) {
  return {
    async read(artistId: string) {
      const params = artistIdParamsSchema.safeParse({ artistId });
      if (!params.success) throw new DomainError("INVALID_REQUEST");
      const record = await store.read(params.data.artistId);
      if (!record) throw new DomainError("NOT_FOUND");
      return response(record);
    },
    // The route validates the query string; this receives the parsed values.
    async search({ query, limit, offset }: ArtistSearchQuery) {
      const { rows, total } = await store.search({ query, limit, offset });
      return artistSearchResponseSchema.parse({
        items: rows.slice(0, limit).map((row) => ({
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          region: row.region,
          verificationStatus: row.verificationStatus,
        })),
        pagination: { limit, offset, hasMore: rows.length > limit, total },
      });
    },
    async create(input: unknown) {
      const parsed = artistCreateRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      for (const wallet of [parsed.data.creatorWallet, parsed.data.payoutWallet]) {
        if (wallet == null) continue;
        try {
          validateWalletAddress(wallet);
          if (wallet === "11111111111111111111111111111111")
            throw new TypeError("Zero wallet");
        } catch {
          throw new DomainError("INVALID_REQUEST");
        }
      }
      const record = await store.create(parsed.data);
      if (!record) throw new DomainError("CONFLICT");
      return response(record);
    },
    async verify(artistId: string, input: unknown, session: WalletSession) {
      const params = artistIdParamsSchema.safeParse({ artistId });
      if (!params.success || !artistVerificationRequestSchema.safeParse(input).success)
        throw new DomainError("INVALID_REQUEST");
      const result = await store.verify(params.data.artistId, session.walletAddress);
      if (result.status === "not_found") throw new DomainError("NOT_FOUND");
      if (result.status === "already_verified") throw new DomainError("CONFLICT");
      return response(result.record);
    },
  };
}
export type ArtistsBoundary = ReturnType<typeof createArtists>;
