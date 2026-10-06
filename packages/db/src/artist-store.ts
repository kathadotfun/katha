import { and, eq, sql } from "drizzle-orm";
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
    ): Promise<ArtistVerificationResult> {
      return db.transaction(async (tx) => {
        // One conditional write wins concurrent approvals; no prior approval is overwritten.
        const [record] = await tx
          .update(artists)
          .set({
            verificationStatus: "VERIFIED",
            verifiedByWallet,
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
