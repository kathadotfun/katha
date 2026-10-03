import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { artworks } from "./artworks.js";

export const physicalCustodyState = pgEnum("physical_custody_state", [
  "UNKNOWN",
  "KATHA_HELD",
  "COLLECTOR_HELD",
  "IN_TRANSIT",
]);
export const fulfillmentKind = pgEnum("fulfillment_kind", [
  "DELIVERY",
  "RETURN_TO_KATHA",
]);
export const fulfillmentStatus = pgEnum("fulfillment_status", [
  "REQUESTED",
  "APPROVED",
  "DISPATCHED",
  "RECEIVED",
  "CANCELLED",
]);

// Manual observations only; finalized Registry custody is reconciled separately.
export const custodyEvents = pgTable(
  "custody_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    // Insert trigger assigns the next revision while holding the artwork row lock.
    revision: bigint("revision", { mode: "number" }).notNull().default(0),
    fromState: physicalCustodyState("from_state").notNull(),
    toState: physicalCustodyState("to_state").notNull(),
    custodianWallet: varchar("custodian_wallet", { length: 44 }).notNull(),
    recordedByWallet: varchar("recorded_by_wallet", { length: 44 }).notNull(),
    evidenceHash: varchar("evidence_hash", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("custody_events_artwork_revision_unique").on(t.artworkId, t.revision),
    check("custody_events_revision_valid", sql`${t.revision} BETWEEN 1 AND 4294967295`),
    check(
      "custody_events_transition_valid",
      sql`
    (${t.fromState} = 'UNKNOWN' AND ${t.toState} IN ('KATHA_HELD', 'COLLECTOR_HELD')) OR
    (${t.fromState} IN ('KATHA_HELD', 'COLLECTOR_HELD') AND ${t.toState} = 'IN_TRANSIT') OR
    (${t.fromState} = 'IN_TRANSIT' AND ${t.toState} IN ('KATHA_HELD', 'COLLECTOR_HELD'))`,
    ),
    check(
      "custody_events_custodian_format",
      sql`${t.custodianWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "custody_events_recorder_format",
      sql`${t.recordedByWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "custody_events_evidence_hash_format",
      sql`${t.evidenceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("custody_events_time_order", sql`${t.occurredAt} <= ${t.recordedAt}`),
  ],
);

// Private operational data. Public artwork/provenance queries must never select it.
export const fulfillmentRequests = pgTable(
  "fulfillment_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "restrict", onUpdate: "restrict" }),
    requesterWallet: varchar("requester_wallet", { length: 44 }).notNull(),
    kind: fulfillmentKind("kind").notNull(),
    status: fulfillmentStatus("status").notNull().default("REQUESTED"),
    recipientName: varchar("recipient_name", { length: 200 }).notNull(),
    contactEmail: varchar("contact_email", { length: 254 }),
    contactPhone: varchar("contact_phone", { length: 40 }),
    addressLines: varchar("address_lines", { length: 200 }).array().notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }),
    postalCode: varchar("postal_code", { length: 32 }),
    countryCode: varchar("country_code", { length: 2 }).notNull(),
    deliveryInstructions: varchar("delivery_instructions", { length: 2000 }),
    courier: varchar("courier", { length: 120 }),
    trackingReference: varchar("tracking_reference", { length: 200 }),
    handledByWallet: varchar("handled_by_wallet", { length: 44 }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fulfillment_requests_requester_index").on(t.requesterWallet),
    index("fulfillment_requests_artwork_index").on(t.artworkId),
    check(
      "fulfillment_requests_requester_format",
      sql`${t.requesterWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
    check(
      "fulfillment_requests_handler_valid",
      sql`(${t.handledByWallet} IS NULL AND ${t.status} IN ('REQUESTED', 'CANCELLED')) OR (${t.handledByWallet} IS NOT NULL AND ${t.handledByWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')`,
    ),
    check(
      "fulfillment_requests_recipient_nonblank",
      sql`${t.recipientName} ~ '[^[:space:]]'`,
    ),
    check(
      "fulfillment_requests_contact_valid",
      sql`
    (${t.contactEmail} IS NOT NULL OR ${t.contactPhone} IS NOT NULL)
    AND (${t.contactEmail} IS NULL OR ${t.contactEmail} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    AND (${t.contactPhone} IS NULL OR ${t.contactPhone} ~ '^[+0-9][0-9 ()-]{4,39}$')`,
    ),
    check(
      "fulfillment_requests_address_valid",
      sql`
    cardinality(${t.addressLines}) BETWEEN 1 AND 5 AND array_ndims(${t.addressLines}) = 1
    AND array_position(${t.addressLines}, NULL) IS NULL
    AND array_to_string(${t.addressLines}, chr(31)) !~ ('(^|' || chr(31) || ')[[:space:]]*(' || chr(31) || '|$)')`,
    ),
    check("fulfillment_requests_city_nonblank", sql`${t.city} ~ '[^[:space:]]'`),
    check("fulfillment_requests_country_format", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check(
      "fulfillment_requests_region_nonblank",
      sql`${t.region} IS NULL OR ${t.region} ~ '[^[:space:]]'`,
    ),
    check(
      "fulfillment_requests_postal_nonblank",
      sql`${t.postalCode} IS NULL OR ${t.postalCode} ~ '[^[:space:]]'`,
    ),
    check(
      "fulfillment_requests_instructions_nonblank",
      sql`${t.deliveryInstructions} IS NULL OR ${t.deliveryInstructions} ~ '[^[:space:]]'`,
    ),
    check(
      "fulfillment_requests_courier_nonblank",
      sql`${t.courier} IS NULL OR ${t.courier} ~ '[^[:space:]]'`,
    ),
    check(
      "fulfillment_requests_tracking_nonblank",
      sql`${t.trackingReference} IS NULL OR ${t.trackingReference} ~ '[^[:space:]]'`,
    ),
    check(
      "fulfillment_requests_timestamp_order",
      sql`${t.updatedAt} >= ${t.createdAt}`,
    ),
  ],
);

export type CustodyEventRecord = typeof custodyEvents.$inferSelect;
export type NewCustodyEventRecord = Omit<typeof custodyEvents.$inferInsert, "revision">;
export type FulfillmentRequestRecord = typeof fulfillmentRequests.$inferSelect;
export type NewFulfillmentRequestRecord = typeof fulfillmentRequests.$inferInsert;
