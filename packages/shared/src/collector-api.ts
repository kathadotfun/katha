import { z } from "zod";
import { walletSessionSchema } from "./wallet-session.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { paginationQuerySchema, paginationResponseSchema } from "./http.js";
import { publicArtworkSummarySchema } from "./artwork-discovery-api.js";
import { provenanceIndexingSchema } from "./artwork-provenance-api.js";
import { physicalCustodyStateSchema } from "./artwork-lifecycle.js";

export const collectorCollectionQuerySchema = paginationQuerySchema;
export const collectorAccountResponseSchema = z.strictObject({
  session: walletSessionSchema,
  indexedArtworkCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  evaluatedAt: z.iso.datetime(),
});
export const collectorHoldingSchema = z.strictObject({
  artwork: publicArtworkSummarySchema,
  assetAddress: walletAddressSchema,
  ownerWallet: walletAddressSchema,
  ownershipSource: z.literal("INDEXED_CORE"),
  custody: z.strictObject({
    state: physicalCustodyStateSchema,
    source: z.enum(["FINALIZED_REGISTRY", "UNKNOWN"]),
    observedAt: z.iso.datetime().nullable(),
  }),
  indexing: provenanceIndexingSchema,
});
export const collectorCollectionResponseSchema = z
  .strictObject({
    walletAddress: walletAddressSchema,
    cluster: walletSessionSchema.shape.cluster,
    evaluatedAt: z.iso.datetime(),
    items: z.array(collectorHoldingSchema).max(100),
    pagination: paginationResponseSchema,
  })
  .refine(
    ({ items, pagination, walletAddress }) =>
      items.length <= pagination.limit &&
      items.every((item) => item.ownerWallet === walletAddress),
  );
export type CollectorCollectionQuery = z.infer<typeof collectorCollectionQuerySchema>;
export type CollectorAccountResponse = z.infer<typeof collectorAccountResponseSchema>;
export type CollectorCollectionResponse = z.infer<
  typeof collectorCollectionResponseSchema
>;
