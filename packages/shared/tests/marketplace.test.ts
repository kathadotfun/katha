import { describe, expect, it } from "vitest";

import {
  basisPointsSchema,
  listingPriceSchema,
  listingStatusSchema,
  marketplaceFeeRatesSchema,
  tokenAmountSchema,
} from "../src/marketplace.js";

const U64_MAX = "18446744073709551615";

describe("listing status", () => {
  it.each(["ACTIVE", "CANCELLED", "PURCHASED", "EXPIRED"])("accepts %s", (status) => {
    expect(listingStatusSchema.parse(status)).toBe(status);
  });

  it.each(["DRAFT", "VERIFIED", "KATHA_HELD", "RESALE_APPROVED", "", null])(
    "rejects a status from another lifecycle dimension: %s",
    (status) => {
      expect(listingStatusSchema.safeParse(status).success).toBe(false);
    },
  );
});

describe("exact token amounts", () => {
  it.each(["0", "1", "1000000", "9007199254740993", U64_MAX])(
    "accepts %s base units",
    (amount) => {
      expect(tokenAmountSchema.parse(amount)).toBe(amount);
    },
  );

  it.each(["1", "1000000", U64_MAX])("accepts positive price %s", (price) => {
    expect(listingPriceSchema.parse(price)).toBe(price);
  });

  it("allows zero for a payment component but not a listing price", () => {
    expect(tokenAmountSchema.safeParse("0").success).toBe(true);
    expect(listingPriceSchema.safeParse("0").success).toBe(false);
  });

  it.each([
    "18446744073709551616",
    "999999999999999999999",
    "01",
    "00",
    "+1",
    "-1",
    "1.0",
    "0.5",
    "1e6",
    " 1",
    "1 ",
    "",
    1,
    1.5,
    9007199254740992,
    -1,
    null,
  ])("rejects noncanonical, inexact, or overflowing amount %s", (amount) => {
    expect(tokenAmountSchema.safeParse(amount).success).toBe(false);
    expect(listingPriceSchema.safeParse(amount).success).toBe(false);
  });
});

describe("fee basis points", () => {
  it.each([0, 250, 500, 10_000])("accepts bounded integer %s", (rate) => {
    expect(basisPointsSchema.parse(rate)).toBe(rate);
  });

  it.each([-1, 10_001, 2.5, NaN, Infinity, "250", null])(
    "rejects invalid basis points %s",
    (rate) => {
      expect(basisPointsSchema.safeParse(rate).success).toBe(false);
    },
  );

  it("accepts the Devnet simulation defaults", () => {
    expect(
      marketplaceFeeRatesSchema.parse({
        platformCommissionBps: 250,
        secondaryRoyaltyBps: 500,
      }),
    ).toEqual({ platformCommissionBps: 250, secondaryRoyaltyBps: 500 });
  });

  it("accepts combined fees at the basis-point ceiling", () => {
    expect(
      marketplaceFeeRatesSchema.safeParse({
        platformCommissionBps: 5_000,
        secondaryRoyaltyBps: 5_000,
      }).success,
    ).toBe(true);
  });

  it.each([
    { platformCommissionBps: 9_501, secondaryRoyaltyBps: 500 },
    { platformCommissionBps: -1, secondaryRoyaltyBps: 500 },
    { platformCommissionBps: 250.5, secondaryRoyaltyBps: 500 },
    { platformCommissionBps: "250", secondaryRoyaltyBps: 500 },
    { platformCommissionBps: 250, secondaryRoyaltyBps: 500, secret: "private" },
  ])("rejects invalid or unlisted fee configuration %#", (rates) => {
    expect(marketplaceFeeRatesSchema.safeParse(rates).success).toBe(false);
  });
});
