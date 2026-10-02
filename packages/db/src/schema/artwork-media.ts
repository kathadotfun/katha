import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";

export const artworkMediaKind = pgEnum("artwork_media_kind", [
  "IMAGE",
  "VIDEO",
  "DOCUMENT",
]);
export const artworkMediaRole = pgEnum("artwork_media_role", [
  "HERO",
  "FRONT",
  "BACK",
  "DETAIL",
  "ARTIST",
  "PROCESS",
  "CERTIFICATE",
  "CONDITION",
  "DOCUMENTARY",
  "OTHER",
]);
export const mediaVisibility = pgEnum("media_visibility", ["PRIVATE", "PUBLIC"]);

export const artworkMedia = pgTable(
  "artwork_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    kind: artworkMediaKind("kind").notNull(),
    role: artworkMediaRole("role").notNull().default("OTHER"),
    visibility: mediaVisibility("visibility").notNull().default("PRIVATE"),
    position: integer("position").notNull(),
    // Provider-relative reference, never a signed URL or an absolute filesystem path.
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    byteSize: bigint("byte_size", { mode: "bigint" }).notNull(),
    altText: varchar("alt_text", { length: 500 }),
    caption: varchar("caption", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("artwork_media_position_unique").on(t.artworkId, t.position),
    uniqueIndex("artwork_media_hero_unique")
      .on(t.artworkId)
      .where(sql`${t.role} = 'HERO'`),
    check("artwork_media_position_valid", sql`${t.position} >= 0`),
    check("artwork_media_hash_format", sql`${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check("artwork_media_size_positive", sql`${t.byteSize} > 0`),
    check(
      "artwork_media_storage_key_valid",
      sql`${t.storageKey} ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' AND ${t.storageKey} !~ '(^|/)\\.\\.?(/|$)' AND ${t.storageKey} !~ '//|/$'`,
    ),
    check(
      "artwork_media_mime_kind_valid",
      sql`(${t.kind} = 'IMAGE' AND ${t.mimeType} IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')) OR (${t.kind} = 'VIDEO' AND ${t.mimeType} IN ('video/mp4', 'video/webm')) OR (${t.kind} = 'DOCUMENT' AND ${t.mimeType} = 'application/pdf')`,
    ),
    check("artwork_media_hero_image", sql`${t.role} <> 'HERO' OR ${t.kind} = 'IMAGE'`),
    check(
      "artwork_media_alt_text_valid",
      sql`(${t.altText} IS NULL OR ${t.altText} ~ '[^[:space:]]') AND (${t.visibility} <> 'PUBLIC' OR ${t.kind} <> 'IMAGE' OR ${t.altText} IS NOT NULL)`,
    ),
    check(
      "artwork_media_caption_nonblank",
      sql`${t.caption} IS NULL OR ${t.caption} ~ '[^[:space:]]'`,
    ),
    check("artwork_media_timestamp_order", sql`${t.updatedAt} >= ${t.createdAt}`),
  ],
);

export type ArtworkMediaRecord = typeof artworkMedia.$inferSelect;
export type NewArtworkMediaRecord = typeof artworkMedia.$inferInsert;
