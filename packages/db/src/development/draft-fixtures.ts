import { eq, sql } from "drizzle-orm";
import { artists } from "../schema/artists.js";
import { artworks } from "../schema/artworks.js";
import { artworkMaterials } from "../schema/artwork-materials.js";
import { validateDatabaseUrl, type Database } from "../connection.js";

export const syntheticArtistId = "04900000-0000-4000-8000-000000000001";
export const syntheticArtistSlug = "synthetic-draft-artist";
export const syntheticDrafts = [
  {
    id: "04900000-0000-4000-8000-000000000011",
    category: "MANDALA",
    title: "Synthetic Mandala Study",
  },
  {
    id: "04900000-0000-4000-8000-000000000012",
    category: "PAUBHA",
    title: "Synthetic Paubha Study",
  },
  {
    id: "04900000-0000-4000-8000-000000000013",
    category: "THANGKA",
    title: "Synthetic Thangka Study",
  },
] as const;

/** The seed command accepts only explicit loopback development/test targets. */
export function validateFixtureDatabaseUrl(value: string | undefined): string {
  const validated = validateDatabaseUrl(value);
  const url = new URL(validated);
  if (
    !new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) ||
    url.search ||
    !/^\/(katha|katha_test|katha_fixture_[a-f0-9]{32})$/.test(url.pathname)
  ) {
    throw new Error(
      "Draft fixtures require a loopback katha development or disposable fixture database without URL options",
    );
  }
  return validated;
}

/** Reserved IDs identify fictional drafts; existing content is never overwritten. */
export async function seedDraftFixtures(db: Database) {
  return db.transaction(async (tx) => {
    // Serialize seed runs before existence checks, avoiding allocation on repeated inserts.
    await tx.execute(sql`select pg_advisory_xact_lock(1262572616, 49)`);
    let createdArtists = 0;
    let createdArtworks = 0;
    const [existingArtist] = await tx
      .select()
      .from(artists)
      .where(eq(artists.id, syntheticArtistId));
    if (existingArtist && existingArtist.slug !== syntheticArtistSlug) {
      throw new Error(
        "Reserved synthetic artist identity conflicts with existing data",
      );
    }
    if (!existingArtist) {
      await tx.insert(artists).values({
        id: syntheticArtistId,
        slug: syntheticArtistSlug,
        displayName: "Synthetic Draft Artist",
        biography:
          "Fictional artist for local development. This profile does not describe a real person.",
        region: "Synthetic local fixture",
        traditions: ["Mandala", "Paubha", "Thangka"],
      });
      createdArtists++;
    }
    const draftIds: { id: string; kathaId: string }[] = [];
    for (const fixture of syntheticDrafts) {
      const [existing] = await tx
        .select()
        .from(artworks)
        .where(eq(artworks.id, fixture.id));
      if (existing) {
        if (
          existing.artistId !== syntheticArtistId ||
          existing.category !== fixture.category
        ) {
          throw new Error(
            "Reserved synthetic artwork identity conflicts with existing data",
          );
        }
        draftIds.push({ id: existing.id, kathaId: existing.kathaId });
        continue;
      }
      const [artwork] = await tx
        .insert(artworks)
        .values({
          ...fixture,
          artistId: syntheticArtistId,
          creationYear: 2026,
          story:
            "Fictional draft for development only; no physical artwork or authenticity claim.",
          culturalContext:
            "Placeholder documentation to exercise structured draft editing.",
        })
        .returning();
      if (!artwork) throw new Error("Synthetic draft insert returned no record");
      await tx.insert(artworkMaterials).values([
        { artworkId: artwork.id, position: 0, name: "Synthetic pigment sample" },
        { artworkId: artwork.id, position: 1, name: "Synthetic canvas sample" },
      ]);
      createdArtworks++;
      draftIds.push({ id: artwork.id, kathaId: artwork.kathaId });
    }
    return { createdArtists, createdArtworks, drafts: draftIds };
  });
}
