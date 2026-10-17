import { sql } from "drizzle-orm";
import {
  check,
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const artistVerificationStatus = pgEnum("artist_verification_status", [
  "UNVERIFIED",
  "VERIFIED",
]);

export const artists = pgTable(
  "artists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull().unique("artists_slug_unique"),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    biography: varchar("biography", { length: 5000 }).notNull(),
    region: varchar("region", { length: 120 }).notNull(),
    traditions: varchar("traditions", { length: 120 }).array().notNull(),
    publicLinks: text("public_links")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    profileImageUrl: varchar("profile_image_url", { length: 2048 }),
    creatorWallet: varchar("creator_wallet", { length: 44 }),
    payoutWallet: varchar("payout_wallet", { length: 44 }),
    verificationStatus: artistVerificationStatus("verification_status")
      .notNull()
      .default("UNVERIFIED"),
    verifiedByWallet: varchar("verified_by_wallet", { length: 44 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    verificationAuthorizationSlot: bigint("verification_authorization_slot", {
      mode: "bigint",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("artists_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("artists_display_name_nonblank", sql`${t.displayName} ~ '[^[:space:]]'`),
    check("artists_biography_nonblank", sql`${t.biography} ~ '[^[:space:]]'`),
    check("artists_region_nonblank", sql`${t.region} ~ '[^[:space:]]'`),
    check(
      "artists_traditions_valid",
      sql`cardinality(${t.traditions}) BETWEEN 1 AND 20 AND array_ndims(${t.traditions}) = 1 AND array_position(${t.traditions}, NULL) IS NULL AND array_to_string(${t.traditions}, chr(31)) !~ ('(^|' || chr(31) || ')[[:space:]]*(' || chr(31) || '|$)')`,
    ),
    check(
      "artists_public_links_valid",
      sql`cardinality(${t.publicLinks}) <= 10 AND coalesce(array_ndims(${t.publicLinks}), 1) = 1 AND array_position(${t.publicLinks}, NULL) IS NULL AND (cardinality(${t.publicLinks}) = 0 OR array_to_string(${t.publicLinks}, chr(31)) ~ ('^https?://[^[:space:]' || chr(31) || ']+(' || chr(31) || 'https?://[^[:space:]' || chr(31) || ']+)*$'))`,
    ),
    check(
      "artists_profile_image_url_format",
      sql`${t.profileImageUrl} IS NULL OR ${t.profileImageUrl} ~ '^https?://[^[:space:]]+$'`,
    ),
    // Textual shape matches shared contracts; chain-facing code must decode addresses.
    check(
      "artists_creator_wallet_format",
      sql`${t.creatorWallet} IS NULL OR ${t.creatorWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "artists_payout_wallet_format",
      sql`${t.payoutWallet} IS NULL OR ${t.payoutWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "artists_verifier_wallet_format",
      sql`${t.verifiedByWallet} IS NULL OR ${t.verifiedByWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "artists_manual_verification_complete",
      sql`(${t.verificationStatus} = 'UNVERIFIED' AND ${t.verifiedByWallet} IS NULL AND ${t.verifiedAt} IS NULL) OR (${t.verificationStatus} = 'VERIFIED' AND ${t.verifiedByWallet} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL)`,
    ),
    check(
      "artists_timestamp_order",
      sql`${t.updatedAt} >= ${t.createdAt} AND (${t.verifiedAt} IS NULL OR ${t.verifiedAt} BETWEEN ${t.createdAt} AND ${t.updatedAt})`,
    ),
  ],
);

export type ArtistRecord = typeof artists.$inferSelect;
export type NewArtistRecord = typeof artists.$inferInsert;
