import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";
import { wallets } from "./wallet-sessions.js";
import { attestationCluster } from "./artwork-attestations.js";

export const blockchainOperationKind = pgEnum("blockchain_operation_kind", [
  "REGISTER_ARTWORK",
  "VERIFY_ARTWORK",
  "RECORD_CONDITION",
  "UPDATE_CUSTODY",
  "MINT_ARTWORK",
  "REVISE_METADATA",
  "CREATE_LISTING",
  "CANCEL_LISTING",
  "PURCHASE_ARTWORK",
]);
export const blockchainOperationStatus = pgEnum("blockchain_operation_status", [
  "PREPARED",
  "UNKNOWN",
  "FAILED",
  "FINALIZED",
]);
export const transactionReceiptStatus = pgEnum("transaction_receipt_status", [
  "UNKNOWN",
  "FAILED",
  "FINALIZED",
]);

export const blockchainOperations = pgTable(
  "blockchain_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "restrict", onUpdate: "restrict" }),
    cluster: attestationCluster("cluster").notNull(),
    kind: blockchainOperationKind("kind").notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    programAddress: varchar("program_address", { length: 44 }).notNull(),
    expectedAccounts: varchar("expected_accounts", { length: 44 }).array().notNull(),
    expectedHashes: varchar("expected_hashes", { length: 64 }).array().notNull(),
    status: blockchainOperationStatus("status").notNull().default("PREPARED"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("blockchain_operations_idempotency_unique").on(
      t.walletId,
      t.cluster,
      t.idempotencyKey,
    ),
    unique("blockchain_operations_id_cluster_unique").on(t.id, t.cluster),
    index("blockchain_operations_artwork_index").on(t.artworkId),
    check(
      "blockchain_operations_key_format",
      sql`${t.idempotencyKey} ~ '^[A-Za-z0-9_-]{1,128}$'`,
    ),
    check(
      "blockchain_operations_request_hash_format",
      sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "blockchain_operations_program_format",
      sql`${t.programAddress} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "blockchain_operations_accounts_valid",
      sql`cardinality(${t.expectedAccounts}) BETWEEN 1 AND 64 AND array_ndims(${t.expectedAccounts}) = 1 AND array_position(${t.expectedAccounts}, NULL) IS NULL AND array_to_string(${t.expectedAccounts}, ',') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}(,[1-9A-HJ-NP-Za-km-z]{32,44})*$'`,
    ),
    check(
      "blockchain_operations_hashes_valid",
      sql`cardinality(${t.expectedHashes}) BETWEEN 0 AND 32 AND (cardinality(${t.expectedHashes}) = 0 OR (array_ndims(${t.expectedHashes}) = 1 AND array_position(${t.expectedHashes}, NULL) IS NULL AND array_to_string(${t.expectedHashes}, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'))`,
    ),
    check(
      "blockchain_operations_time_order",
      sql`isfinite(${t.createdAt}) AND isfinite(${t.updatedAt}) AND ${t.updatedAt} >= ${t.createdAt}`,
    ),
  ],
);

export const transactionReceipts = pgTable(
  "transaction_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id").notNull(),
    cluster: attestationCluster("cluster").notNull(),
    signature: varchar("signature", { length: 88 }).notNull(),
    messageHash: varchar("message_hash", { length: 64 }).notNull(),
    status: transactionReceiptStatus("status").notNull().default("UNKNOWN"),
    failureCode: varchar("failure_code", { length: 64 }),
    slot: bigint("slot", { mode: "bigint" }),
    chainRecordedAt: timestamp("chain_recorded_at", {
      withTimezone: true,
      mode: "date",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "transaction_receipts_operation_cluster_fk",
      columns: [t.operationId, t.cluster],
      foreignColumns: [blockchainOperations.id, blockchainOperations.cluster],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    unique("transaction_receipts_signature_unique").on(t.cluster, t.signature),
    index("transaction_receipts_operation_index").on(t.operationId),
    check(
      "transaction_receipts_signature_format",
      sql`${t.signature} ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'`,
    ),
    check(
      "transaction_receipts_message_hash_format",
      sql`${t.messageHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "transaction_receipts_outcome_complete",
      sql`(${t.status} = 'UNKNOWN' AND ${t.failureCode} IS NULL AND ${t.slot} IS NULL AND ${t.chainRecordedAt} IS NULL AND ${t.finalizedAt} IS NULL) OR (${t.status} = 'FAILED' AND ${t.failureCode} IS NOT NULL AND ${t.failureCode} ~ '^[A-Z0-9_]{1,64}$' AND ${t.slot} IS NULL AND ${t.chainRecordedAt} IS NULL AND ${t.finalizedAt} IS NULL) OR (${t.status} = 'FINALIZED' AND ${t.failureCode} IS NULL AND ${t.slot} IS NOT NULL AND ${t.slot} >= 0 AND ${t.chainRecordedAt} IS NOT NULL AND isfinite(${t.chainRecordedAt}) AND ${t.finalizedAt} IS NOT NULL AND isfinite(${t.finalizedAt}) AND ${t.finalizedAt} >= ${t.chainRecordedAt} AND ${t.observedAt} >= ${t.finalizedAt})`,
    ),
    check(
      "transaction_receipts_time_order",
      sql`isfinite(${t.createdAt}) AND isfinite(${t.observedAt}) AND ${t.observedAt} >= ${t.createdAt}`,
    ),
  ],
);

export type BlockchainOperationRecord = typeof blockchainOperations.$inferSelect;
export type NewBlockchainOperationRecord = Omit<
  typeof blockchainOperations.$inferInsert,
  "status" | "createdAt" | "updatedAt"
>;
export type TransactionReceiptRecord = typeof transactionReceipts.$inferSelect;
export type NewTransactionReceiptRecord = Omit<
  typeof transactionReceipts.$inferInsert,
  | "status"
  | "failureCode"
  | "slot"
  | "chainRecordedAt"
  | "finalizedAt"
  | "createdAt"
  | "observedAt"
>;
