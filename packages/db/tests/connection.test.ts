import { describe, expect, it } from "vitest";
import { createDatabase, validateDatabaseUrl } from "../src/index.js";

describe("explicit database configuration", () => {
  it.each([
    undefined,
    "",
    "not-a-url",
    "https://localhost/db",
    "postgres://localhost/",
    " postgres://localhost/db",
    "postgres://localhost/db#fragment",
  ])("rejects invalid configuration without echoing credentials: %s", (value) => {
    expect(() => validateDatabaseUrl(value)).toThrow(
      "DATABASE_URL must be a PostgreSQL URL",
    );
  });
  it.each([
    "postgres://localhost/katha",
    "postgresql://user:synthetic-password@127.0.0.1:5432/katha?sslmode=disable",
  ])("accepts PostgreSQL configuration: %s", (value) => {
    expect(validateDatabaseUrl(value)).toBe(value);
  });
  it("does not include a malformed URL in its error", () => {
    const value = "https://user:private-value@localhost/katha";
    expect(() => validateDatabaseUrl(value)).toThrow(
      "DATABASE_URL must be a PostgreSQL URL with a host and database name",
    );
  });
  it("constructs and closes a lazy connection without a running server", async () => {
    const connection = createDatabase("postgres://127.0.0.1:1/katha");
    expect(connection.db).toBeDefined();
    await connection.close();
  });
});
