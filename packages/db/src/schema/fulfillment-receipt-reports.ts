import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, varchar, uuid } from "drizzle-orm/pg-core";
import { fulfillmentRequests } from "./custody-fulfillment.js";
// A collector's private receipt claim, independently confirmed by the operator.
export const fulfillmentReceiptReports = pgTable(
  "fulfillment_receipt_reports",
  {
    requestId: uuid("request_id")
      .primaryKey()
      .references(() => fulfillmentRequests.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    reporterWallet: varchar("reporter_wallet", { length: 44 }).notNull(),
    reportedAt: timestamp("reported_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "fulfillment_receipt_reports_wallet_format",
      sql`${t.reporterWallet} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'`,
    ),
  ],
);
