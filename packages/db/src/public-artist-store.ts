import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artists } from "./schema/artists.js";

const summaryColumns = {
  id: artists.id,
  slug: artists.slug,
  displayName: artists.displayName,
  region: artists.region,
  traditions: artists.traditions,
  profileImageUrl: artists.profileImageUrl,
  verificationStatus: artists.verificationStatus,
};
export function createPublicArtistStore(db: Database) {
  return {
    async list({ limit, offset }: { limit: number; offset: number }) {
      return db
        .select(summaryColumns)
        .from(artists)
        .where(eq(artists.verificationStatus, "VERIFIED"))
        .orderBy(asc(artists.slug))
        .limit(limit + 1)
        .offset(offset);
    },
    async findBySlug(slug: string) {
      // Select public columns only; payment and verifier wallet details stay private.
      const [record] = await db
        .select({
          ...summaryColumns,
          biography: artists.biography,
          publicLinks: artists.publicLinks,
          creatorWallet: artists.creatorWallet,
          verifiedAt: artists.verifiedAt,
        })
        .from(artists)
        .where(and(eq(artists.slug, slug), eq(artists.verificationStatus, "VERIFIED")));
      return record;
    },
  };
}
export type PublicArtistStore = ReturnType<typeof createPublicArtistStore>;
