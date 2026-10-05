import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";
import { attestationCluster } from "./artwork-attestations.js";

export const indexedEventKind = pgEnum("indexed_event_kind", [
  "REGISTRY",
  "OWNERSHIP",
  "LISTING",
  "SALE",
]);
export const indexedListingStatus = pgEnum("indexed_listing_status", [
  "ACTIVE",
  "CANCELLED",
  "PURCHASED",
  "EXPIRED",
]);

export const indexedEvents = pgTable(
  "indexed_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cluster: attestationCluster("cluster").notNull(),
    programAddress: varchar("program_address", { length: 44 }).notNull(),
    signature: varchar("signature", { length: 88 }).notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    outerInstructionIndex: integer("outer_instruction_index").notNull(),
    // -1 identifies a top-level instruction; nonnegative values identify inner CPI instructions.
    innerInstructionIndex: integer("inner_instruction_index").notNull().default(-1),
    eventIndex: integer("event_index").notNull().default(0),
    kind: indexedEventKind("kind").notNull(),
    artworkId: uuid("artwork_id").references(() => artworks.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    assetAddress: varchar("asset_address", { length: 44 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    chainRecordedAt: timestamp("chain_recorded_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    indexedAt: timestamp("indexed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("indexed_events_identity_unique").on(
      t.cluster,
      t.signature,
      t.outerInstructionIndex,
      t.innerInstructionIndex,
      t.eventIndex,
    ),
    unique("indexed_events_projection_reference_unique").on(
      t.id,
      t.cluster,
      t.artworkId,
    ),
    index("indexed_events_artwork_order_index").on(
      t.artworkId,
      t.cluster,
      t.slot,
      t.transactionIndex,
      t.outerInstructionIndex,
      t.innerInstructionIndex,
      t.eventIndex,
    ),
    check(
      "indexed_events_addresses_valid",
      sql`${t.programAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (${t.assetAddress} IS NULL OR ${t.assetAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')`,
    ),
    check(
      "indexed_events_signature_valid",
      sql`${t.signature} ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'`,
    ),
    check(
      "indexed_events_position_valid",
      sql`${t.slot} >= 0 AND ${t.transactionIndex} >= 0 AND ${t.outerInstructionIndex} >= 0 AND ${t.innerInstructionIndex} >= -1 AND ${t.eventIndex} >= 0`,
    ),
    check(
      "indexed_events_payload_valid",
      sql`jsonb_typeof(${t.payload}) = 'object' AND octet_length(${t.payload}::text) <= 65536`,
    ),
    check(
      "indexed_events_scope_valid",
      sql`${t.kind} = 'REGISTRY' OR (${t.artworkId} IS NOT NULL AND ${t.assetAddress} IS NOT NULL)`,
    ),
    check(
      "indexed_events_times_finite",
      sql`isfinite(${t.chainRecordedAt}) AND isfinite(${t.indexedAt}) AND ${t.indexedAt} >= ${t.chainRecordedAt}`,
    ),
  ],
);

export const indexerCheckpoints = pgTable(
  "indexer_checkpoints",
  {
    cluster: attestationCluster("cluster").notNull(),
    programAddress: varchar("program_address", { length: 44 }).notNull(),
    fromSlot: bigint("from_slot", { mode: "bigint" }).notNull(),
    scannedThroughSlot: bigint("scanned_through_slot", { mode: "bigint" }),
    lastSignature: varchar("last_signature", { length: 88 }),
    lastSignatureSlot: bigint("last_signature_slot", { mode: "bigint" }),
    gapReason: varchar("gap_reason", { length: 32 }),
    gapFromSlot: bigint("gap_from_slot", { mode: "bigint" }),
    gapThroughSlot: bigint("gap_through_slot", { mode: "bigint" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cluster, t.programAddress] }),
    check(
      "indexer_checkpoints_program_valid",
      sql`${t.programAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "indexer_checkpoints_bounds_valid",
      sql`${t.fromSlot} >= 0 AND (${t.scannedThroughSlot} IS NULL OR ${t.scannedThroughSlot} >= ${t.fromSlot}) AND ((${t.lastSignature} IS NULL AND ${t.lastSignatureSlot} IS NULL) OR (${t.lastSignature} IS NOT NULL AND ${t.lastSignature} ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' AND ${t.lastSignatureSlot} IS NOT NULL AND ${t.lastSignatureSlot} >= ${t.fromSlot} AND ${t.scannedThroughSlot} IS NOT NULL AND ${t.lastSignatureSlot} <= ${t.scannedThroughSlot}))`,
    ),
    check(
      "indexer_checkpoints_gap_valid",
      sql`(${t.gapFromSlot} IS NULL AND ${t.gapThroughSlot} IS NULL) OR (${t.gapFromSlot} IS NOT NULL AND ${t.gapThroughSlot} IS NOT NULL AND ${t.gapFromSlot} >= ${t.fromSlot} AND ${t.gapThroughSlot} >= ${t.gapFromSlot})`,
    ),
    check(
      "indexer_checkpoints_gap_reason_valid",
      sql`${t.gapReason} IS NULL OR (${t.gapFromSlot} IS NOT NULL AND ${t.gapReason} IN ('HISTORY_UNAVAILABLE', 'BOUNDARY_MISSING', 'PAGE_LIMIT', 'EVIDENCE_INVALID', 'OWNER_MISMATCH', 'NETWORK_CHANGED', 'NETWORK_UNBOUND'))`,
    ),
    check("indexer_checkpoints_time_finite", sql`isfinite(${t.updatedAt})`),
  ],
);

function projectionColumns() {
  return {
    cluster: attestationCluster("cluster").notNull(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    assetAddress: varchar("asset_address", { length: 44 }).notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
  };
}
function amount(name: string) {
  return numeric(name, { mode: "bigint" }).notNull();
}

export const artworkOwnership = pgTable(
  "artwork_ownership",
  {
    ...projectionColumns(),
    ownerWallet: varchar("owner_wallet", { length: 44 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cluster, t.artworkId] }),
    unique("artwork_ownership_asset_unique").on(t.cluster, t.assetAddress),
    foreignKey({
      name: "artwork_ownership_event_fk",
      columns: [t.sourceEventId, t.cluster, t.artworkId],
      foreignColumns: [
        indexedEvents.id,
        indexedEvents.cluster,
        indexedEvents.artworkId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("artwork_ownership_owner_index").on(t.cluster, t.ownerWallet),
    check(
      "artwork_ownership_addresses_valid",
      sql`${t.assetAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.ownerWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
  ],
);

export const artworkListings = pgTable(
  "artwork_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...projectionColumns(),
    listingAddress: varchar("listing_address", { length: 44 }).notNull(),
    sellerWallet: varchar("seller_wallet", { length: 44 }).notNull(),
    paymentMint: varchar("payment_mint", { length: 44 }).notNull(),
    price: amount("price"),
    status: indexedListingStatus("status").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    unique("artwork_listings_address_unique").on(t.cluster, t.listingAddress),
    unique("artwork_listings_sale_reference_unique").on(t.id, t.cluster, t.artworkId),
    uniqueIndex("artwork_listings_active_unique")
      .on(t.cluster, t.artworkId)
      .where(sql`${t.status} = 'ACTIVE'`),
    foreignKey({
      name: "artwork_listings_event_fk",
      columns: [t.sourceEventId, t.cluster, t.artworkId],
      foreignColumns: [
        indexedEvents.id,
        indexedEvents.cluster,
        indexedEvents.artworkId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "artwork_listings_addresses_valid",
      sql`${t.assetAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.listingAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.sellerWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.paymentMint} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "artwork_listings_price_valid",
      sql`scale(${t.price}) = 0 AND ${t.price} BETWEEN 1 AND 18446744073709551615`,
    ),
    check("artwork_listings_expiry_finite", sql`isfinite(${t.expiresAt})`),
  ],
);

export const artworkSales = pgTable(
  "artwork_sales",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...projectionColumns(),
    listingId: uuid("listing_id").notNull().unique("artwork_sales_listing_unique"),
    buyerWallet: varchar("buyer_wallet", { length: 44 }).notNull(),
    sellerWallet: varchar("seller_wallet", { length: 44 }).notNull(),
    paymentMint: varchar("payment_mint", { length: 44 }).notNull(),
    price: amount("price"),
    isPrimary: boolean("is_primary").notNull(),
    proceedsWallet: varchar("proceeds_wallet", { length: 44 }).notNull(),
    proceedsAmount: amount("proceeds_amount"),
    artistWallet: varchar("artist_wallet", { length: 44 }).notNull(),
    royaltyAmount: amount("royalty_amount"),
    treasuryWallet: varchar("treasury_wallet", { length: 44 }).notNull(),
    platformFee: amount("platform_fee"),
  },
  (t) => [
    unique("artwork_sales_event_unique").on(t.sourceEventId),
    foreignKey({
      name: "artwork_sales_event_fk",
      columns: [t.sourceEventId, t.cluster, t.artworkId],
      foreignColumns: [
        indexedEvents.id,
        indexedEvents.cluster,
        indexedEvents.artworkId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    foreignKey({
      name: "artwork_sales_listing_fk",
      columns: [t.listingId, t.cluster, t.artworkId],
      foreignColumns: [
        artworkListings.id,
        artworkListings.cluster,
        artworkListings.artworkId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "artwork_sales_addresses_valid",
      sql`${t.assetAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.buyerWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.sellerWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.paymentMint} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.proceedsWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.artistWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.treasuryWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "artwork_sales_amounts_valid",
      sql`scale(${t.price}) = 0 AND scale(${t.proceedsAmount}) = 0 AND scale(${t.royaltyAmount}) = 0 AND scale(${t.platformFee}) = 0 AND ${t.price} BETWEEN 1 AND 18446744073709551615 AND ${t.proceedsAmount} BETWEEN 0 AND 18446744073709551615 AND ${t.royaltyAmount} BETWEEN 0 AND 18446744073709551615 AND ${t.platformFee} BETWEEN 0 AND 18446744073709551615 AND ${t.price} = ${t.proceedsAmount} + ${t.royaltyAmount} + ${t.platformFee}`,
    ),
    check(
      "artwork_sales_recipient_scope",
      sql`(${t.isPrimary} AND ${t.royaltyAmount} = 0 AND ${t.proceedsWallet} = ${t.artistWallet}) OR (NOT ${t.isPrimary} AND ${t.proceedsWallet} = ${t.sellerWallet})`,
    ),
  ],
);

export type IndexedEventRecord = typeof indexedEvents.$inferSelect;
export type NewIndexedEventRecord = typeof indexedEvents.$inferInsert;
export type IndexerCheckpointRecord = typeof indexerCheckpoints.$inferSelect;
export type NewIndexerCheckpointRecord = typeof indexerCheckpoints.$inferInsert;
export type ArtworkOwnershipRecord = typeof artworkOwnership.$inferSelect;
export type NewArtworkOwnershipRecord = typeof artworkOwnership.$inferInsert;
export type ArtworkListingRecord = typeof artworkListings.$inferSelect;
export type NewArtworkListingRecord = typeof artworkListings.$inferInsert;
export type ArtworkSaleRecord = typeof artworkSales.$inferSelect;
export type NewArtworkSaleRecord = typeof artworkSales.$inferInsert;
