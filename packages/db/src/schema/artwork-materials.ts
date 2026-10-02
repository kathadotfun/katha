import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";

export const artworkMaterials = pgTable(
  "artwork_materials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("artwork_materials_position_unique").on(t.artworkId, t.position),
    uniqueIndex("artwork_materials_name_unique").on(t.artworkId, sql`lower(${t.name})`),
    check("artwork_materials_position_valid", sql`${t.position} >= 0`),
    // Each material is a separate row, not a delimited list.
    check(
      "artwork_materials_name_valid",
      sql`${t.name} ~ '[^[:space:]]' AND ${t.name} = btrim(${t.name}) AND position(',' in ${t.name}) = 0`,
    ),
  ],
);

export type ArtworkMaterialRecord = typeof artworkMaterials.$inferSelect;
export type NewArtworkMaterialRecord = typeof artworkMaterials.$inferInsert;
