import { sql } from "drizzle-orm";
import {
  pgTable,
  varchar,
  bigint,
  boolean,
  timestamp,
  uuid,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { attestationCluster } from "./artwork-attestations.js";
import { indexedEvents } from "./blockchain-read-models.js";

export const indexerNetworks = pgTable(
  "indexer_networks",
  {
    cluster: attestationCluster("cluster").notNull(),
    registryProgram: varchar("registry_program", { length: 44 }).notNull(),
    collection: varchar("collection", { length: 44 }).notNull(),
    genesisHash: varchar("genesis_hash", { length: 44 }).notNull(),
    finalizedSlot: bigint("finalized_slot", { mode: "bigint" }).notNull(),
    blocked: boolean("blocked").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cluster, t.registryProgram] }),
    check(
      "indexer_networks_values_valid",
      sql`${t.registryProgram} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.collection} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.genesisHash} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ${t.finalizedSlot} >= 0 AND isfinite(${t.updatedAt})`,
    ),
  ],
);

export const ownershipReconciliations = pgTable(
  "ownership_reconciliations",
  {
    cluster: attestationCluster("cluster").notNull(),
    artworkId: uuid("artwork_id").notNull(),
    sourceEventId: uuid("source_event_id").notNull(),
    indexedOwner: varchar("indexed_owner", { length: 44 }).notNull(),
    observedOwner: varchar("observed_owner", { length: 44 }),
    observedSlot: bigint("observed_slot", { mode: "bigint" }).notNull(),
    status: varchar("status", { length: 16 })
      .$type<"MATCH" | "MISMATCH" | "MISSING" | "INVALID">()
      .notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cluster, t.artworkId] }),
    foreignKey({
      columns: [t.sourceEventId, t.cluster, t.artworkId],
      foreignColumns: [
        indexedEvents.id,
        indexedEvents.cluster,
        indexedEvents.artworkId,
      ],
      name: "ownership_reconciliations_event_fk",
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    check(
      "ownership_reconciliations_values_valid",
      sql`${t.indexedOwner} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (${t.observedOwner} IS NULL OR ${t.observedOwner} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') AND ${t.observedSlot} >= 0 AND isfinite(${t.checkedAt}) AND ((${t.status} = 'MATCH' AND ${t.observedOwner} IS NOT NULL AND ${t.observedOwner} = ${t.indexedOwner}) OR (${t.status} = 'MISMATCH' AND ${t.observedOwner} IS NOT NULL AND ${t.observedOwner} <> ${t.indexedOwner}) OR (${t.status} IN ('MISSING', 'INVALID') AND ${t.observedOwner} IS NULL))`,
    ),
  ],
);
