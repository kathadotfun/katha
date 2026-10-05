import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { blockchainOperations } from "./blockchain-operations.js";

export const operationPreparations = pgTable(
  "operation_preparations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => blockchainOperations.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    canonicalRequest: text("canonical_request").notNull(),
    messageHash: varchar("message_hash", { length: 64 }).notNull(),
    transactionBase64: text("transaction_base64").notNull(),
    transactionVersion: integer("transaction_version").notNull(),
    blockhash: varchar("blockhash", { length: 44 }).notNull(),
    lastValidBlockHeight: bigint("last_valid_block_height", {
      mode: "bigint",
    }).notNull(),
    simulationSlot: bigint("simulation_slot", { mode: "bigint" }).notNull(),
    simulationUnits: bigint("simulation_units", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("operation_preparations_message_unique").on(t.operationId, t.messageHash),
    check(
      "operation_preparations_request_bound",
      sql`octet_length(${t.canonicalRequest}) BETWEEN 2 AND 65536 AND jsonb_typeof(${t.canonicalRequest}::jsonb) = 'object'`,
    ),
    check(
      "operation_preparations_hash_format",
      sql`${t.messageHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "operation_preparations_wire_format",
      sql`length(${t.transactionBase64}) BETWEEN 4 AND 5464 AND ${t.transactionBase64} ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'`,
    ),
    check(
      "operation_preparations_version_valid",
      sql`${t.transactionVersion} IN (0,1)`,
    ),
    check(
      "operation_preparations_blockhash_format",
      sql`${t.blockhash} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "operation_preparations_numbers_valid",
      sql`${t.lastValidBlockHeight} >= 0 AND ${t.simulationSlot} >= 0 AND (${t.simulationUnits} IS NULL OR ${t.simulationUnits} >= 0) AND isfinite(${t.createdAt})`,
    ),
  ],
);
export type NewOperationPreparation = Omit<
  typeof operationPreparations.$inferInsert,
  "id" | "operationId" | "createdAt"
>;
