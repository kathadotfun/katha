import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";

export const attestationStatus = pgEnum("attestation_status", [
  "DRAFT",
  "PREPARED",
  "FINALIZED",
]);
export const attestationCluster = pgEnum("attestation_cluster", ["LOCALNET", "DEVNET"]);
export const conditionGrade = pgEnum("condition_grade", [
  "EXCELLENT",
  "GOOD",
  "FAIR",
  "POOR",
  "DAMAGED",
]);
export const conditionReason = pgEnum("condition_reason", [
  "INITIAL_VERIFICATION",
  "PRE_SALE",
  "POST_DELIVERY",
  "PRE_RESALE",
  "RETURN_TO_CUSTODY",
  "INSURANCE",
]);

// Each table gets fresh column builders; receipt shape is shared across records.
function attestationColumns() {
  return {
    id: uuid("id").defaultRandom().primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    status: attestationStatus("status").notNull().default("DRAFT"),
    authorityWallet: varchar("authority_wallet", { length: 44 }).notNull(),
    canonicalDocument: text("canonical_document"),
    documentHash: varchar("document_hash", { length: 64 }),
    chainCluster: attestationCluster("chain_cluster"),
    chainSignature: varchar("chain_signature", { length: 88 }),
    chainSlot: bigint("chain_slot", { mode: "bigint" }),
    chainRecordedAt: timestamp("chain_recorded_at", {
      withTimezone: true,
      mode: "date",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  };
}
type AttestationColumns = {
  [K in keyof ReturnType<typeof attestationColumns>]: AnyPgColumn;
};

function attestationChecks(t: AttestationColumns, prefix: string) {
  return [
    check(
      `${prefix}_authority_format`,
      sql`${t.authorityWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      `${prefix}_document_integrity`,
      sql`
      (${t.canonicalDocument} IS NULL AND ${t.documentHash} IS NULL AND ${t.status} = 'DRAFT') OR
      (${t.canonicalDocument} IS NOT NULL AND ${t.documentHash} IS NOT NULL
       AND octet_length(convert_to(${t.canonicalDocument}, 'UTF8')) BETWEEN 2 AND 1048576
       AND jsonb_typeof(${t.canonicalDocument}::jsonb) = 'object'
       AND ${t.documentHash} ~ '^[0-9a-f]{64}$'
       AND ${t.documentHash} = encode(sha256(convert_to(${t.canonicalDocument}, 'UTF8')), 'hex'))`,
    ),
    check(
      `${prefix}_receipt_complete`,
      sql`
      (${t.status} <> 'FINALIZED' AND ${t.chainCluster} IS NULL AND ${t.chainSignature} IS NULL AND ${t.chainSlot} IS NULL
       AND ${t.chainRecordedAt} IS NULL AND ${t.finalizedAt} IS NULL) OR
      (${t.status} = 'FINALIZED' AND ${t.chainCluster} IS NOT NULL AND ${t.chainSignature} IS NOT NULL AND ${t.chainSlot} IS NOT NULL
       AND ${t.chainRecordedAt} IS NOT NULL AND ${t.finalizedAt} IS NOT NULL
       AND ${t.chainSignature} ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       AND ${t.chainSlot} >= 0 AND ${t.finalizedAt} >= ${t.chainRecordedAt})`,
    ),
    check(
      `${prefix}_timestamp_order`,
      sql`${t.updatedAt} >= ${t.createdAt} AND (${t.finalizedAt} IS NULL OR ${t.finalizedAt} <= ${t.updatedAt})`,
    ),
  ];
}

export const artworkMetadataVersions = pgTable(
  "artwork_metadata_versions",
  {
    ...attestationColumns(),
    version: bigint("version", { mode: "number" }).notNull(),
    chainVersion: bigint("chain_version", { mode: "number" }),
    uri: varchar("uri", { length: 200 }),
  },
  (t) => [
    ...attestationChecks(t, "metadata_versions"),
    unique("metadata_versions_artwork_version_unique").on(t.artworkId, t.version),
    uniqueIndex("metadata_versions_chain_version_unique")
      .on(t.artworkId, t.chainCluster, t.chainVersion)
      .where(sql`${t.status} = 'FINALIZED'`),
    check(
      "metadata_versions_chain_version_valid",
      sql`(${t.status} <> 'FINALIZED' AND ${t.chainVersion} IS NULL) OR (${t.status} = 'FINALIZED' AND ${t.chainVersion} IS NOT NULL AND ${t.chainVersion} BETWEEN 1 AND 4294967295)`,
    ),
    check(
      "metadata_versions_version_valid",
      sql`${t.version} BETWEEN 1 AND 4294967295`,
    ),
    check(
      "metadata_versions_uri_valid",
      sql`
      (${t.uri} IS NULL AND ${t.status} = 'DRAFT') OR
      (${t.uri} IS NOT NULL AND ${t.uri} ~ '^https?://[^[:space:]@/#?]+([/?][^[:space:]#]*)?$'
       AND octet_length(${t.uri}) <= 200 AND ${t.uri} !~ '[^\x20-\x7e]')`,
    ),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    ...attestationColumns(),
    inspectedAt: timestamp("inspected_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
    notes: varchar("notes", { length: 5000 }),
  },
  (t) => [
    ...attestationChecks(t, "verifications"),
    // Registry authenticates an artwork once; unfinished manual work is separate.
    uniqueIndex("verifications_finalized_artwork_unique")
      .on(t.artworkId)
      .where(sql`${t.status} = 'FINALIZED'`),
    check(
      "verifications_evidence_hash_format",
      sql`${t.evidenceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "verifications_notes_nonblank",
      sql`${t.notes} IS NULL OR ${t.notes} ~ '[^[:space:]]'`,
    ),
    check(
      "verifications_inspection_order",
      sql`${t.inspectedAt} <= ${t.updatedAt} AND (${t.chainRecordedAt} IS NULL OR ${t.inspectedAt} <= ${t.chainRecordedAt})`,
    ),
  ],
);

export const conditionReports = pgTable(
  "condition_reports",
  {
    ...attestationColumns(),
    version: bigint("version", { mode: "number" }).notNull(),
    chainVersion: bigint("chain_version", { mode: "number" }),
    inspectorId: uuid("inspector_id").notNull(),
    grade: conditionGrade("grade").notNull(),
    reason: conditionReason("reason").notNull(),
    inspectedAt: timestamp("inspected_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    reportedAt: timestamp("reported_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    notes: varchar("notes", { length: 5000 }).notNull(),
    // Snapshot hashes survive edits/removal of current artwork_media rows.
    mediaHashes: varchar("media_hashes", { length: 64 }).array().notNull(),
    ownerWallet: varchar("owner_wallet", { length: 44 }),
    custodyRevision: bigint("custody_revision", { mode: "number" }),
  },
  (t) => [
    ...attestationChecks(t, "condition_reports"),
    unique("condition_reports_artwork_version_unique").on(t.artworkId, t.version),
    uniqueIndex("condition_reports_chain_version_unique")
      .on(t.artworkId, t.chainCluster, t.chainVersion)
      .where(sql`${t.status} = 'FINALIZED'`),
    check(
      "condition_reports_chain_version_valid",
      sql`(${t.status} <> 'FINALIZED' AND ${t.chainVersion} IS NULL) OR (${t.status} = 'FINALIZED' AND ${t.chainVersion} IS NOT NULL AND ${t.chainVersion} BETWEEN 1 AND 4294967295)`,
    ),
    check(
      "condition_reports_version_valid",
      sql`${t.version} BETWEEN 1 AND 4294967295`,
    ),
    check("condition_reports_notes_nonblank", sql`${t.notes} ~ '[^[:space:]]'`),
    check(
      "condition_reports_media_hashes_valid",
      sql`
      cardinality(${t.mediaHashes}) BETWEEN 1 AND 20 AND array_ndims(${t.mediaHashes}) = 1
      AND array_position(${t.mediaHashes}, NULL) IS NULL
      AND array_to_string(${t.mediaHashes}, ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'`,
    ),
    check(
      "condition_reports_inspection_order",
      sql`${t.reportedAt} >= ${t.inspectedAt} AND ${t.updatedAt} >= ${t.reportedAt} AND (${t.chainRecordedAt} IS NULL OR ${t.chainRecordedAt} >= ${t.inspectedAt})`,
    ),
    check(
      "condition_reports_owner_scope_valid",
      sql`
      (${t.ownerWallet} IS NULL AND ${t.custodyRevision} IS NULL) OR
      (${t.ownerWallet} IS NOT NULL AND ${t.custodyRevision} IS NOT NULL
       AND ${t.ownerWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
       AND ${t.custodyRevision} BETWEEN 1 AND 4294967295)`,
    ),
  ],
);

export type ArtworkMetadataVersionRecord = typeof artworkMetadataVersions.$inferSelect;
export type NewArtworkMetadataVersionRecord =
  typeof artworkMetadataVersions.$inferInsert;
export type VerificationRecord = typeof verifications.$inferSelect;
export type NewVerificationRecord = typeof verifications.$inferInsert;
export type ConditionReportRecord = typeof conditionReports.$inferSelect;
export type NewConditionReportRecord = typeof conditionReports.$inferInsert;
