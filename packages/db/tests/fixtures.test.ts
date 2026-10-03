import { describe, expect, it } from "vitest";
import { validateFixtureDatabaseUrl } from "../src/development/draft-fixtures.js";

describe("fixture command target boundaries", () => {
  it.each([
    "postgres://localhost/katha",
    "postgresql://test:synthetic@127.0.0.1:5432/katha_test",
    "postgres://[::1]/katha",
    "postgres://localhost/katha_fixture_0123456789abcdef0123456789abcdef",
  ])("accepts explicit local fixture target %s", (url) => {
    expect(validateFixtureDatabaseUrl(url)).toBe(url);
  });
  it.each([
    undefined,
    "",
    "postgres://remote.example/katha",
    "postgres://localhost/production",
    "postgres://localhost/katha?host=remote.example",
    "postgres://localhost/katha?sslmode=require",
    "postgres://localhost/katha#fragment",
    "postgres://localhost/katha_fixture_other",
    "postgres://localhost/%6batha",
    "https://localhost/katha",
  ])("rejects unsafe or ambiguous fixture target %s without leaking it", (url) => {
    expect(() => validateFixtureDatabaseUrl(url)).toThrow();
    try {
      validateFixtureDatabaseUrl(url);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (url) expect(error.message).not.toContain(url);
    }
  });
});
