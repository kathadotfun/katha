import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { artists } from "./artists.js";

export const artworkCategory = pgEnum("artwork_category", [
  "MANDALA",
  "PAUBHA",
  "THANGKA",
]);

export const artworkIdCounters = pgTable(
  "artwork_id_counters",
  {
    category: artworkCategory("category").primaryKey(),
    lastValue: integer("last_value").notNull(),
  },
  (t) => [check("artwork_id_counters_range", sql`${t.lastValue} BETWEEN 1 AND 999999`)],
);

export const artworks = pgTable(
  "artworks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The insert trigger replaces this sentinel before constraints are checked.
    kathaId: varchar("katha_id", { length: 32 })
      .notNull()
      .default("")
      .unique("artworks_katha_id_unique"),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "restrict", onUpdate: "restrict" }),
    category: artworkCategory("category").notNull(),
    creatorWallet: varchar("creator_wallet", { length: 44 }),
    title: varchar("title", { length: 200 }).notNull(),
    creationYear: integer("creation_year").notNull(),
    authorshipEvidenceHash: varchar("authorship_evidence_hash", { length: 64 }),
    heightMm: integer("height_mm"),
    widthMm: integer("width_mm"),
    depthMm: integer("depth_mm"),
    originCountryCode: varchar("origin_country_code", { length: 2 })
      .notNull()
      .default("NP"),
    originRegion: varchar("origin_region", { length: 120 }),
    originLocality: varchar("origin_locality", { length: 120 }),
    technique: varchar("technique", { length: 500 }),
    story: varchar("story", { length: 10000 }),
    meaning: varchar("meaning", { length: 5000 }),
    culturalContext: varchar("cultural_context", { length: 5000 }),
    creationProcess: varchar("creation_process", { length: 5000 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "artworks_katha_id_format",
      sql`${t.kathaId} ~ ('^KATHA-' || ${t.category}::text || '-[0-9]{6}$') AND right(${t.kathaId}, 6) <> '000000'`,
    ),
    check("artworks_title_nonblank", sql`${t.title} ~ '[^[:space:]]'`),
    check("artworks_creation_year_range", sql`${t.creationYear} BETWEEN 1 AND 9999`),
    check(
      "artworks_creator_wallet_format",
      sql`${t.creatorWallet} IS NULL OR ${t.creatorWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "artworks_authorship_hash_format",
      sql`${t.authorshipEvidenceHash} IS NULL OR ${t.authorshipEvidenceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "artworks_dimensions_valid",
      sql`(${t.heightMm} IS NULL AND ${t.widthMm} IS NULL AND ${t.depthMm} IS NULL) OR (${t.heightMm} IS NOT NULL AND ${t.widthMm} IS NOT NULL AND ${t.heightMm} > 0 AND ${t.widthMm} > 0 AND (${t.depthMm} IS NULL OR ${t.depthMm} > 0))`,
    ),
    check("artworks_country_code_format", sql`${t.originCountryCode} ~ '^[A-Z]{2}$'`),
    check(
      "artworks_origin_region_nonblank",
      sql`${t.originRegion} IS NULL OR ${t.originRegion} ~ '[^[:space:]]'`,
    ),
    check(
      "artworks_origin_locality_nonblank",
      sql`${t.originLocality} IS NULL OR ${t.originLocality} ~ '[^[:space:]]'`,
    ),
    check(
      "artworks_technique_nonblank",
      sql`${t.technique} IS NULL OR ${t.technique} ~ '[^[:space:]]'`,
    ),
    check(
      "artworks_story_nonblank",
      sql`${t.story} IS NULL OR ${t.story} ~ '[^[:space:]]'`,
    ),
    check(
      "artworks_meaning_nonblank",
      sql`${t.meaning} IS NULL OR ${t.meaning} ~ '[^[:space:]]'`,
    ),
    check(
      "artworks_cultural_context_nonblank",
      sql`${t.culturalContext} IS NULL OR ${t.culturalContext} ~ '[^[:space:]]'`,
    ),
    check(
      "artworks_creation_process_nonblank",
      sql`${t.creationProcess} IS NULL OR ${t.creationProcess} ~ '[^[:space:]]'`,
    ),
    check("artworks_timestamp_order", sql`${t.updatedAt} >= ${t.createdAt}`),
  ],
);

export type ArtworkRecord = typeof artworks.$inferSelect;
export type NewArtworkRecord = Omit<
  typeof artworks.$inferInsert,
  "id" | "kathaId" | "creatorWallet"
>;
