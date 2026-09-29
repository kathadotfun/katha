import { z } from "zod";

// Time can make an ACTIVE listing ineligible before expiry recovery records EXPIRED.
export const listingStatusSchema = z.enum([
  "ACTIVE",
  "CANCELLED",
  "PURCHASED",
  "EXPIRED",
]);
export type ListingStatus = z.infer<typeof listingStatusSchema>;

const U64_MAX = "18446744073709551615";
const canonicalUnsignedDecimal = /^(0|[1-9][0-9]*)$/;

// SPL token base units must fit a u64; canonical text preserves exact JSON values.
export const tokenAmountSchema = z
  .string()
  .regex(canonicalUnsignedDecimal)
  .refine(
    (value) =>
      value.length < U64_MAX.length ||
      (value.length === U64_MAX.length && value <= U64_MAX),
    { error: "Token amount exceeds u64" },
  );
export type TokenAmount = z.infer<typeof tokenAmountSchema>;

export const listingPriceSchema = tokenAmountSchema.refine((value) => value !== "0", {
  error: "Listing price must be positive",
});
export type ListingPrice = z.infer<typeof listingPriceSchema>;

export const basisPointsSchema = z.number().int().min(0).max(10_000);
export type BasisPoints = z.infer<typeof basisPointsSchema>;

export const marketplaceFeeRatesSchema = z
  .strictObject({
    platformCommissionBps: basisPointsSchema,
    secondaryRoyaltyBps: basisPointsSchema,
  })
  .refine(
    ({ platformCommissionBps, secondaryRoyaltyBps }) =>
      platformCommissionBps + secondaryRoyaltyBps <= 10_000,
    { error: "Combined fees exceed 10000 basis points" },
  );
export type MarketplaceFeeRates = z.infer<typeof marketplaceFeeRatesSchema>;
