import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  bigint,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";
export const resaleInspectionRequests = pgTable(
  "resale_inspection_requests",
  {
    id: uuid("id").primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    ownerWallet: varchar("owner_wallet", { length: 44 }).notNull(),
    custodyRevision: bigint("custody_revision", { mode: "bigint" }).notNull(),
    conditionVersion: bigint("condition_version", { mode: "number" }).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("resale_inspection_requests_scope_unique").on(
      t.artworkId,
      t.ownerWallet,
      t.custodyRevision,
      t.conditionVersion,
    ),
    check(
      "resale_inspection_requests_wallet_format",
      sql`${t.ownerWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "resale_inspection_requests_condition_valid",
      sql`${t.conditionVersion} BETWEEN 1 AND 4294967294`,
    ),
    check(
      "resale_inspection_requests_revision_valid",
      sql`${t.custodyRevision} BETWEEN 1 AND 4294967295`,
    ),
  ],
);
