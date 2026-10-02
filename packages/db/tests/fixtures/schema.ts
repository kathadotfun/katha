import { integer, pgTable } from "drizzle-orm/pg-core";

// Synthetic migration fixture, never exported by the application schema.
export const migrationProbe = pgTable("migration_probe", {
  id: integer("id").primaryKey(),
});
