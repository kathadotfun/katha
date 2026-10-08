import { registrationStatusSchema } from "./artwork-registration-review.js";
import { paginationResponseSchema } from "./http.js";
import { kathaIdSchema } from "./artwork-identity.js";
import { z } from "zod";
import { walletAddressSchema } from "./artwork-domain.js";
import {
  physicalCustodyTransitionSchema,
  physicalCustodyStateSchema,
} from "./artwork-lifecycle.js";
import { artworkRegistrationRequestSchema } from "./artwork-registration-api.js";
const timestamp = z.iso.datetime({ precision: 3 });
export const custodyPreparationRequestSchema = artworkRegistrationRequestSchema
  .omit({ metadataVersionId: true })
  .extend({
    expectedCustodyRevision: z
      .string()
      .max(20)
      .regex(/^(0|[1-9][0-9]*)$/)
      .refine(
        (v) =>
          /^(0|[1-9][0-9]*)$/.test(v) &&
          v.length <= 20 &&
          BigInt(v) < 18446744073709551615n,
      ),
    transition: physicalCustodyTransitionSchema,
    collectorWallet: walletAddressSchema.nullable(),
    movementConfirmed: z.literal(true),
    fulfillmentId: z
      .uuid()
      .transform((v) => v.toLowerCase())
      .optional(),
  });
const nonblank = (max: number) => z.string().trim().min(1).max(max);
export const fulfillmentCreateRequestSchema = z
  .strictObject({
    requestId: z.uuid().transform((v) => v.toLowerCase()),
    kind: z.enum(["DELIVERY", "RETURN_TO_KATHA"]),
    recipientName: nonblank(200),
    contactEmail: z.email().max(254).nullable(),
    contactPhone: z
      .string()
      .regex(/^[+0-9][0-9 ()-]{4,39}$/)
      .nullable(),
    addressLines: z.array(nonblank(200)).min(1).max(5),
    city: nonblank(120),
    region: nonblank(120).nullable(),
    postalCode: nonblank(32).nullable(),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    deliveryInstructions: nonblank(2000).nullable(),
  })
  .refine((v) => v.contactEmail !== null || v.contactPhone !== null);
export const fulfillmentUpdateRequestSchema = z.strictObject({
  expectedUpdatedAt: timestamp,
  status: z.enum(["APPROVED", "DISPATCHED", "RECEIVED", "CANCELLED"]),
  manualConfirmation: z.literal(true),
  courier: nonblank(120).nullable().optional(),
  trackingReference: nonblank(200).nullable().optional(),
});
export const fulfillmentIdParamsSchema = z.strictObject({
  requestId: z.uuid().transform((v) => v.toLowerCase()),
});
export const fulfillmentResponseSchema = z.strictObject({
  id: z.uuid(),
  kathaId: kathaIdSchema,
  kind: z.enum(["DELIVERY", "RETURN_TO_KATHA"]),
  status: z.enum(["REQUESTED", "APPROVED", "DISPATCHED", "RECEIVED", "CANCELLED"]),
  recipientName: nonblank(200),
  contactEmail: z.email().nullable(),
  contactPhone: z.string().nullable(),
  addressLines: z.array(z.string()),
  city: z.string(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
  deliveryInstructions: z.string().nullable(),
  courier: z.string().nullable(),
  trackingReference: z.string().nullable(),
  ownerReportedReceivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type FulfillmentCreateRequest = z.infer<typeof fulfillmentCreateRequestSchema>;
export type FulfillmentUpdateRequest = z.infer<typeof fulfillmentUpdateRequestSchema>;

export type CustodyPreparationRequest = z.infer<typeof custodyPreparationRequestSchema>;
export type FulfillmentResponse = z.infer<typeof fulfillmentResponseSchema>;
export const custodyAdministrationReviewSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    title: z.string().min(1).max(200),
    updatedAt: timestamp,
    cluster: z.enum(["localnet", "devnet"]),
    chain: z.strictObject({
      revision: custodyPreparationRequestSchema.shape.expectedCustodyRevision,
      state: physicalCustodyStateSchema,
      subject: walletAddressSchema.nullable(),
      ownerWallet: walletAddressSchema.nullable(),
      custodyAuthority: walletAddressSchema,
    }),
    canAttest: z.boolean(),
    transitions: z.array(physicalCustodyTransitionSchema).max(6),
    custody: registrationStatusSchema,
    requests: z
      .array(
        z.strictObject({
          request: fulfillmentResponseSchema,
          ownerMatches: z.boolean(),
          allowedStatuses: z.array(fulfillmentUpdateRequestSchema.shape.status).max(4),
          transitions: z.array(physicalCustodyTransitionSchema).max(2),
        }),
      )
      .max(100),
    pagination: paginationResponseSchema,
  })
  .refine((v) => v.requests.length <= v.pagination.limit)
  .refine(
    (v) => new Set(v.requests.map((row) => row.request.id)).size === v.requests.length,
  )
  .refine(
    (v) =>
      v.transitions.every((t) => t.from === v.chain.state) &&
      v.requests.every(
        (row) =>
          row.request.kathaId === v.kathaId &&
          row.transitions.every((t) =>
            v.transitions.some((allowed) => allowed.action === t.action),
          ),
      ),
  );
export type CustodyAdministrationReview = z.infer<
  typeof custodyAdministrationReviewSchema
>;

export const fulfillmentReceiptRequestSchema = z.strictObject({
  expectedUpdatedAt: timestamp,
  receiptConfirmed: z.literal(true),
});
export type FulfillmentReceiptRequest = z.infer<typeof fulfillmentReceiptRequestSchema>;
export const collectorDeliveryReviewSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    title: nonblank(200),
    cluster: z.enum(["localnet", "devnet"]),
    ownerWallet: walletAddressSchema,
    custodyState: physicalCustodyStateSchema,
    custodyRevision: custodyPreparationRequestSchema.shape.expectedCustodyRevision,
    canRequest: z.boolean(),
    requests: z.array(fulfillmentResponseSchema).max(100),
    pagination: paginationResponseSchema,
  })
  .refine(
    (v) =>
      v.requests.length <= v.pagination.limit &&
      v.requests.every((row) => row.kathaId === v.kathaId) &&
      new Set(v.requests.map((row) => row.id)).size === v.requests.length,
  );
export type CollectorDeliveryReview = z.infer<typeof collectorDeliveryReviewSchema>;
