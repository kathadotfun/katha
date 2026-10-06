import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";
import { wallets } from "./wallet-sessions.js";

export const nfcTags = pgTable(
  "nfc_tags",
  {
    tagId: uuid("tag_id").primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assignedByWalletId: uuid("assigned_by_wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
    retiredByWalletId: uuid("retired_by_wallet_id").references(() => wallets.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
  },
  (t) => [
    uniqueIndex("nfc_tags_one_active_artwork")
      .on(t.artworkId)
      .where(sql`${t.retiredAt} IS NULL`),
    check(
      "nfc_tags_retirement",
      sql`(${t.retiredAt} IS NULL AND ${t.retiredByWalletId} IS NULL) OR (${t.retiredAt} IS NOT NULL AND ${t.retiredAt} >= ${t.assignedAt} AND ${t.retiredByWalletId} IS NOT NULL)`,
    ),
  ],
);
