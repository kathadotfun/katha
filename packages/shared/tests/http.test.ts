import { expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorResponseSchema,
  paginationQuerySchema,
  countedPaginatedResponseSchema,
  paginatedResponseSchema,
  tokenAmountSchema,
} from "../src/index.js";

it("defaults and bounds canonical pagination query strings", () => {
  expect(paginationQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  expect(paginationQuerySchema.parse({ limit: "100", offset: "100000" })).toEqual({
    limit: 100,
    offset: 100000,
  });
});
it.each(["0", "101", "01", "-1", "1.5", "1e2", " 2", "", 20, null])(
  "rejects invalid limits %s",
  (limit) => {
    expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
  },
);
it.each(["100001", "00", "-1", "0.5", "1e3", " 0", "", 0, null])(
  "rejects invalid offsets %s",
  (offset) => {
    expect(paginationQuerySchema.safeParse({ offset }).success).toBe(false);
  },
);
it("rejects unknown query fields and oversized response pages", () => {
  expect(paginationQuerySchema.safeParse({ sort: "private" }).success).toBe(false);
  const schema = paginatedResponseSchema(z.string());
  expect(
    schema.safeParse({
      items: Array(101).fill("fixture"),
      pagination: { limit: 100, offset: 0, hasMore: true },
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      items: ["a", "b"],
      pagination: { limit: 1, offset: 0, hasMore: true },
    }).success,
  ).toBe(false);
  expect(
    schema.parse({ items: [], pagination: { limit: 20, offset: 0, hasMore: false } })
      .items,
  ).toEqual([]);
});
it("counted pages keep the total consistent with the page they describe", () => {
  const schema = countedPaginatedResponseSchema(z.string());
  const page = (items: string[], pagination: object) =>
    schema.safeParse({ items, pagination });
  expect(page(["a"], { limit: 1, offset: 0, hasMore: true, total: 3 }).success).toBe(
    true,
  );
  expect(page(["c"], { limit: 1, offset: 2, hasMore: false, total: 3 }).success).toBe(
    true,
  );
  // A page past the end may report any total but never "more pages".
  expect(page([], { limit: 20, offset: 40, hasMore: false, total: 3 }).success).toBe(
    true,
  );
  expect(page([], { limit: 20, offset: 40, hasMore: true, total: 99 }).success).toBe(
    false,
  );
  for (const pagination of [
    { limit: 1, offset: 2, hasMore: false, total: 2 },
    { limit: 1, offset: 0, hasMore: false, total: 3 },
    { limit: 1, offset: 0, hasMore: true, total: 1 },
    { limit: 1, offset: 0, hasMore: true, total: -1 },
    { limit: 1, offset: 0, hasMore: true, total: 1.5 },
    { limit: 1, offset: 0, hasMore: true },
  ])
    expect(page(["a"], pagination).success).toBe(false);
});
it("shares strict error response contracts without private extras", () => {
  const value = {
    error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." },
    requestId: "b55d5929-a53d-4608-82d1-f6d91c1ba563",
  };
  expect(apiErrorResponseSchema.parse(value)).toEqual(value);
  expect(apiErrorResponseSchema.safeParse({ ...value, stack: "private" }).success).toBe(
    false,
  );
});
it("preserves exact decimal strings through JSON validation", () => {
  const amount = "18446744073709551615";
  expect(tokenAmountSchema.parse(JSON.parse(JSON.stringify(amount)))).toBe(amount);
  expect(tokenAmountSchema.safeParse(Number(amount)).success).toBe(false);
});
