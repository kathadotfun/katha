import { z } from "zod";
import { kathaIdSchema } from "./artwork-identity.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { walletClusterSchema } from "./wallet-session.js";
import { listingPriceSchema, tokenAmountSchema } from "./marketplace.js";
import {
  operationIntentSchema,
  unsignedOperationResponseSchema,
  listingOperationKindSchema,
} from "./blockchain-operation.js";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";
const revision = tokenAmountSchema.refine(
  (value) => BigInt(value) < 18446744073709551615n,
);
const timestamp = tokenAmountSchema.refine(
  (value) => BigInt(value) > 0n && BigInt(value) <= 9223372036854775807n,
);
export const listingCreateRequestSchema = z.strictObject({
  idempotencyKey: operationIntentSchema.shape.idempotencyKey,
  expectedRevision: revision,
  price: listingPriceSchema,
  expiresAt: timestamp,
  supportedTransactionVersions:
    artworkRegistrationRequestSchema.shape.supportedTransactionVersions,
});
export const listingCancelRequestSchema = listingCreateRequestSchema.omit({
  price: true,
  expiresAt: true,
});
export const listingPreparationResponseSchema = unsignedOperationResponseSchema.extend({
  kind: listingOperationKindSchema,
  currentRevision: tokenAmountSchema,
  nextRevision: tokenAmountSchema,
  expiresAt: timestamp,
  price: listingPriceSchema,
});
export const artworkListingResponseSchema = z.strictObject({
  kathaId: kathaIdSchema,
  cluster: walletClusterSchema,
  commitment: z.literal("finalized"),
  observedSlot: tokenAmountSchema,
  chainTime: timestamp,
  owner: walletAddressSchema,
  asset: walletAddressSchema,
  currentRevision: tokenAmountSchema,
  listing: z
    .strictObject({
      address: walletAddressSchema,
      status: z.enum(["ACTIVE", "CANCELLED", "EXPIRED", "PURCHASED"]),
      revision: tokenAmountSchema,
      completedSales: tokenAmountSchema,
      saleKind: z.enum(["PRIMARY", "SECONDARY"]),
      seller: walletAddressSchema,
      paymentMint: walletAddressSchema,
      decimals: z.literal(6),
      price: listingPriceSchema,
      createdAt: timestamp,
      expiresAt: timestamp,
      active: z.boolean(),
    })
    .nullable(),
});
export type ListingCreateRequest = z.infer<typeof listingCreateRequestSchema>;
export type ListingCancelRequest = z.infer<typeof listingCancelRequestSchema>;
export type ArtworkListingResponse = z.infer<typeof artworkListingResponseSchema>;
