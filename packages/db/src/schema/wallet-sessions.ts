import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { attestationCluster } from "./artwork-attestations.js";

export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    address: varchar("address", { length: 44 })
      .notNull()
      .unique("wallets_address_unique"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "wallets_address_format",
      sql`${t.address} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
  ],
);

export const walletChallenges = pgTable(
  "wallet_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade", onUpdate: "restrict" }),
    nonce: varchar("nonce", { length: 64 })
      .notNull()
      .unique("wallet_challenges_nonce_unique"),
    domain: varchar("domain", { length: 253 }).notNull(),
    cluster: attestationCluster("cluster").notNull(),
    message: text("message").notNull(),
    messageHash: varchar("message_hash", { length: 64 }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    unique("wallet_challenges_id_wallet_unique").on(t.id, t.walletId),
    index("wallet_challenges_wallet_index").on(t.walletId),
    check("wallet_challenges_nonce_format", sql`${t.nonce} ~ '^[0-9a-f]{64}$'`),
    check(
      "wallet_challenges_domain_format",
      sql`${t.domain} ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'`,
    ),
    check(
      "wallet_challenges_message_integrity",
      sql`octet_length(convert_to(${t.message}, 'UTF8')) BETWEEN 1 AND 4096 AND ${t.messageHash} ~ '^[0-9a-f]{64}$' AND ${t.messageHash} = encode(sha256(convert_to(${t.message}, 'UTF8')), 'hex')`,
    ),
    check(
      "wallet_challenges_time_order",
      sql`isfinite(${t.issuedAt}) AND isfinite(${t.expiresAt}) AND ${t.expiresAt} > ${t.issuedAt} AND (${t.consumedAt} IS NULL OR ${t.consumedAt} >= ${t.issuedAt} AND ${t.consumedAt} < ${t.expiresAt})`,
    ),
  ],
);

// Raw opaque tokens never enter persistence; only their SHA-256 digest is stored.
export const walletSessions = pgTable(
  "wallet_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade", onUpdate: "restrict" }),
    challengeId: uuid("challenge_id")
      .notNull()
      .unique("wallet_sessions_challenge_unique"),
    tokenHash: varchar("token_hash", { length: 64 })
      .notNull()
      .unique("wallet_sessions_token_hash_unique"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    foreignKey({
      name: "wallet_sessions_challenge_wallet_fk",
      columns: [t.challengeId, t.walletId],
      foreignColumns: [walletChallenges.id, walletChallenges.walletId],
    })
      .onDelete("cascade")
      .onUpdate("restrict"),
    index("wallet_sessions_wallet_index").on(t.walletId),
    check("wallet_sessions_token_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "wallet_sessions_time_order",
      sql`isfinite(${t.createdAt}) AND isfinite(${t.expiresAt}) AND ${t.expiresAt} > ${t.createdAt} AND (${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt})`,
    ),
  ],
);

export type WalletRecord = typeof wallets.$inferSelect;
export type NewWalletRecord = typeof wallets.$inferInsert;
export type WalletChallengeRecord = typeof walletChallenges.$inferSelect;
export type NewWalletChallengeRecord = Omit<
  typeof walletChallenges.$inferInsert,
  "consumedAt"
>;
export type WalletSessionRecord = typeof walletSessions.$inferSelect;
export type NewWalletSessionRecord = Omit<
  typeof walletSessions.$inferInsert,
  "createdAt" | "revokedAt"
>;
