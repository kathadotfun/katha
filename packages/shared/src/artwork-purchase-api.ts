import { z } from "zod";
import { listingCreateRequestSchema } from "./artwork-listing-api.js";
import { unsignedOperationResponseSchema } from "./blockchain-operation.js";
import { kathaIdSchema } from "./artwork-identity.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { walletClusterSchema } from "./wallet-session.js";
import {
  tokenAmountSchema,
  listingPriceSchema,
  marketplaceFeeRatesSchema,
} from "./marketplace.js";
export const purchaseQuoteRequestSchema = listingCreateRequestSchema.pick({
  supportedTransactionVersions: true,
});
export const purchasePrepareRequestSchema = purchaseQuoteRequestSchema.extend({
  idempotencyKey: listingCreateRequestSchema.shape.idempotencyKey,
  quoteHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const saleDistributionSchema = z.strictObject({
  sellerProceeds: tokenAmountSchema,
  artistProceeds: tokenAmountSchema,
  treasuryFee: tokenAmountSchema,
  recipients: z
    .array(z.strictObject({ wallet: walletAddressSchema, amount: listingPriceSchema }))
    .min(1)
    .max(3),
});
export const purchaseQuoteTermsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kathaId: kathaIdSchema,
  cluster: walletClusterSchema,
  buyer: walletAddressSchema,
  asset: walletAddressSchema,
  listing: walletAddressSchema,
  revision: tokenAmountSchema,
  price: listingPriceSchema,
  expiresAt: tokenAmountSchema.refine(
    (v) => BigInt(v) > 0n && BigInt(v) <= 9223372036854775807n,
  ),
  saleKind: z.enum(["PRIMARY", "SECONDARY"]),
  seller: walletAddressSchema,
  artistPayout: walletAddressSchema,
  treasury: walletAddressSchema,
  payment: z.strictObject({
    kind: z.literal("DEVNET_TEST_TOKEN"),
    paymentMint: walletAddressSchema,
    decimals: z.literal(6),
    simulation: z.literal(true),
    label: z.literal("Katha test token (no monetary value)"),
  }),
  fees: marketplaceFeeRatesSchema,
  distribution: saleDistributionSchema,
  condition: z.strictObject({
    report: walletAddressSchema,
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    version: z.number().int().positive().max(4294967295),
  }),
  custodyRevision: tokenAmountSchema,
});
export const purchaseQuoteResponseSchema = purchaseQuoteTermsSchema.extend({
  quoteHash: z.string().regex(/^[0-9a-f]{64}$/),
  commitment: z.literal("finalized"),
  observedSlot: tokenAmountSchema,
  chainTime: tokenAmountSchema,
  simulation: unsignedOperationResponseSchema.shape.simulation,
});
export const purchasePreparationResponseSchema = unsignedOperationResponseSchema.extend(
  {
    kind: z.literal("PURCHASE_ARTWORK"),
    quote: purchaseQuoteResponseSchema,
    nextRevision: tokenAmountSchema,
  },
);
export type PurchaseQuoteTerms = z.infer<typeof purchaseQuoteTermsSchema>;
export type PurchaseQuoteResponse = z.infer<typeof purchaseQuoteResponseSchema>;
