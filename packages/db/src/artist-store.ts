import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { Database } from "./connection.js";
import { artists, type ArtistRecord, type NewArtistRecord } from "./schema/artists.js";

type ArtistCreation = Pick<
  NewArtistRecord,
  | "slug"
  | "displayName"
  | "biography"
  | "region"
  | "traditions"
  | "publicLinks"
  | "profileImageUrl"
  | "creatorWallet"
  | "payoutWallet"
>;

type ArtistVerificationResult =
  | { status: "verified"; record: ArtistRecord }
  | { status: "already_verified" }
  | { status: "not_found" };

export function createArtistStore(db: Database) {
  return {
    async read(id: string) {
      const [record] = await db.select().from(artists).where(eq(artists.id, id));
      return record;
    },
    async search({
      query,
      limit,
      offset,
    }: {
      query: string;
      limit: number;
      offset: number;
    }) {
      // Escape LIKE wildcards so operator input matches literally.
      const pattern = `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
      const where = or(
        ilike(artists.displayName, pattern),
        ilike(artists.slug, pattern),
        // An exact record ID also finds its artist, without any partial ID matching.
        sql`${artists.id}::text = ${query.toLowerCase()}`,
      );
      const rows = await db
        .select({
          total: sql<number>`count(*) over ()`.mapWith(Number),
          id: artists.id,
          slug: artists.slug,
          displayName: artists.displayName,
          region: artists.region,
          verificationStatus: artists.verificationStatus,
        })
        .from(artists)
        .where(where)
        .orderBy(asc(artists.displayName), asc(artists.id))
        .limit(limit + 1)
        .offset(offset);
      if (rows.length) return { rows, total: rows[0]!.total };
      const [counted] = await db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(artists)
        .where(where);
      return { rows, total: counted?.total ?? 0 };
    },
    async create(input: ArtistCreation) {
      // Explicit columns prevent callers from assigning identity or verification fields.
      const [record] = await db
        .insert(artists)
        .values({
          slug: input.slug,
          displayName: input.displayName,
          biography: input.biography,
          region: input.region,
          traditions: input.traditions,
          publicLinks: input.publicLinks ?? [],
          profileImageUrl: input.profileImageUrl ?? null,
          creatorWallet: input.creatorWallet ?? null,
          payoutWallet: input.payoutWallet ?? null,
        })
        .onConflictDoNothing({ target: artists.slug })
        .returning();
      return record;
    },
    async verify(
      id: string,
      verifiedByWallet: string,
      authorize?: () => Promise<bigint | undefined>,
    ): Promise<ArtistVerificationResult> {
      return db.transaction(async (tx) => {
        // Recheck finalized permission immediately before the conditional write.
        // The slot records the decision; revocation cannot undo an in-flight DB commit.
        const authorizationSlot = await authorize?.();
        // One conditional write wins concurrent approvals; no prior approval is overwritten.
        const [record] = await tx
          .update(artists)
          .set({
            verificationStatus: "VERIFIED",
            verifiedByWallet,
            verificationAuthorizationSlot: authorizationSlot ?? null,
            verifiedAt: sql`statement_timestamp()`,
            updatedAt: sql`statement_timestamp()`,
          })
          .where(and(eq(artists.id, id), eq(artists.verificationStatus, "UNVERIFIED")))
          .returning();
        if (record) return { status: "verified" as const, record };
        const [existing] = await tx
          .select({ id: artists.id })
          .from(artists)
          .where(eq(artists.id, id));
        return existing ? { status: "already_verified" } : { status: "not_found" };
      });
    },
  };
}
export type ArtistStore = ReturnType<typeof createArtistStore>;
