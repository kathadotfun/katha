import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function validateDatabaseUrl(value: string | undefined): string {
  const invalid = () =>
    new Error("DATABASE_URL must be a PostgreSQL URL with a host and database name");
  if (!value || value !== value.trim()) throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2 ||
    url.pathname === "/" ||
    url.hash
  )
    throw invalid();
  return value;
}

/** Importing this package never connects or reads environment variables. */
export function createDatabase(databaseUrl: string) {
  const client = postgres(validateDatabaseUrl(databaseUrl), {
    max: 10,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });
  return {
    db: drizzle({ client, schema }),
    close: () => client.end({ timeout: 5 }),
  };
}

export type Database = ReturnType<typeof createDatabase>["db"];
