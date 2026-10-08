import { z } from "zod";
import { tokenAmountSchema } from "./marketplace.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { kathaIdSchema } from "./artwork-identity.js";
import { conditionGradeSchema, conditionReasonSchema } from "./condition-report.js";
import { physicalCustodyStateSchema } from "./artwork-lifecycle.js";
import { paginationQuerySchema, paginationResponseSchema } from "./http.js";
import { publicArtworkSummarySchema } from "./artwork-discovery-api.js";

const slot = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(19)
  .refine(
    (s) =>
      /^(0|[1-9][0-9]*)$/.test(s) &&
      s.length <= 19 &&
      BigInt(s) <= 9223372036854775807n,
  );
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const time = z.iso.datetime({ precision: 3 });
const version = z.number().int().min(1).max(4294967295);
export const provenanceTypeSchema = z.enum([
  "REGISTRATION",
  "VERIFICATION",
  "METADATA",
  "CONDITION",
  "CUSTODY",
  "MINT",
  "TRANSFER",
]);
export const artworkProvenanceParamsSchema = z.strictObject({ kathaId: kathaIdSchema });
export const artworkProvenanceQuerySchema = paginationQuerySchema.extend({
  type: provenanceTypeSchema.optional(),
});
export type ArtworkProvenanceQuery = z.infer<typeof artworkProvenanceQuerySchema>;
const base = {
  id: z.uuid(),
  programAddress: walletAddressSchema,
  transaction: z.strictObject({
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
    slot,
    recordedAt: time,
  }),
  position: z.strictObject({
    transactionIndex: z.number().int().nonnegative(),
    outerInstructionIndex: z.number().int().nonnegative(),
    innerInstructionIndex: z.number().int().min(-1),
    eventIndex: z.number().int().nonnegative(),
  }),
};
export const publicSaleEvidenceSchema = z
  .strictObject({
    listingAddress: walletAddressSchema,
    listingRevision: tokenAmountSchema.refine((s) => s !== "0"),
    marketplaceProgram: walletAddressSchema,
    isPrimary: z.boolean(),
    sellerWallet: walletAddressSchema,
    buyerWallet: walletAddressSchema,
    paymentMint: walletAddressSchema,
    price: tokenAmountSchema,
    proceedsWallet: walletAddressSchema,
    proceedsAmount: tokenAmountSchema,
    artistWallet: walletAddressSchema,
    royaltyAmount: tokenAmountSchema,
    treasuryWallet: walletAddressSchema,
    platformFee: tokenAmountSchema,
  })
  .refine(
    (s) =>
      [s.price, s.proceedsAmount, s.royaltyAmount, s.platformFee].every(
        (value) => tokenAmountSchema.safeParse(value).success,
      ) &&
      BigInt(s.price) > 0n &&
      BigInt(s.price) ===
        BigInt(s.proceedsAmount) + BigInt(s.royaltyAmount) + BigInt(s.platformFee) &&
      (s.isPrimary
        ? s.royaltyAmount === "0" && s.proceedsWallet === s.artistWallet
        : s.proceedsWallet === s.sellerWallet),
  );
const publicInspectionMediaSchema = z.strictObject({
  contentHash: hash,
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif"]),
  altText: z.string().min(1).max(500),
});
export const publicProvenanceEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    type: z.literal("REGISTRATION"),
    data: z.strictObject({
      registryRecordAddress: walletAddressSchema,
      artistId: z.uuid(),
      creatorWallet: walletAddressSchema.nullable(),
      authorshipEvidenceHash: hash,
      registeredBy: walletAddressSchema,
      registeredAt: time,
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("VERIFICATION"),
    data: z.strictObject({
      authorshipEvidenceHash: hash,
      verifierWallet: walletAddressSchema,
      verifiedAt: time,
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("METADATA"),
    data: z.strictObject({
      version,
      documentHash: hash,
      revisionAddress: walletAddressSchema,
      committedBy: walletAddressSchema,
      committedAt: time,
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("CONDITION"),
    data: z.strictObject({
      version,
      reportAddress: walletAddressSchema,
      documentHash: hash,
      grade: conditionGradeSchema,
      reason: conditionReasonSchema,
      verifierWallet: walletAddressSchema,
      inspectedAt: time,
      recordedAt: time,
      publicMedia: z.array(publicInspectionMediaSchema).max(20).default([]),
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("CUSTODY"),
    data: z.strictObject({
      revision: slot,
      fromState: physicalCustodyStateSchema,
      toState: physicalCustodyStateSchema,
      attestedBy: walletAddressSchema,
      recordedAt: time,
    }),
  }),
  z.strictObject({
    ...base,
    type: z.literal("MINT"),
    data: z.strictObject({
      assetAddress: walletAddressSchema,
      initialOwner: walletAddressSchema,
      metadataVersion: version,
      metadataHash: hash,
      mintedBy: walletAddressSchema,
      mintedAt: time,
    }),
  }),
  // A transfer instruction identifies its destination and authority, not necessarily the previous owner.
  z.strictObject({
    ...base,
    type: z.literal("TRANSFER"),
    data: z.strictObject({
      assetAddress: walletAddressSchema,
      newOwner: walletAddressSchema,
      authorityWallet: walletAddressSchema,
      sale: publicSaleEvidenceSchema.nullable().default(null),
    }),
  }),
]);
export type PublicProvenanceEvent = z.infer<typeof publicProvenanceEventSchema>;
export const provenanceIndexingSchema = z.strictObject({
  status: z.enum(["UNKNOWN", "GAP_DETECTED", "LAGGING", "STALE", "AT_OBSERVED_HEAD"]),
  evaluatedAt: time,
  // This is the worker's last observation, never a live RPC claim made by this endpoint.
  network: z
    .strictObject({
      genesisHash: walletAddressSchema,
      collectionAddress: walletAddressSchema,
      observedFinalizedSlot: slot,
      observedAt: time,
      blocked: z.boolean(),
    })
    .nullable(),
  streams: z
    .array(
      z.strictObject({
        programAddress: walletAddressSchema,
        checkpoint: z
          .strictObject({
            fromSlot: slot,
            scannedThroughSlot: slot.nullable(),
            lagSlots: slot.nullable(),
            gapFromSlot: slot.nullable(),
            gapThroughSlot: slot.nullable(),
            gapReason: z
              .enum([
                "HISTORY_UNAVAILABLE",
                "BOUNDARY_MISSING",
                "PAGE_LIMIT",
                "EVIDENCE_INVALID",
                "OWNER_MISMATCH",
                "NETWORK_CHANGED",
                "NETWORK_UNBOUND",
              ])
              .nullable(),
            updatedAt: time,
          })
          .nullable(),
      }),
    )
    .min(2)
    .max(3),
  ownerCheck: z
    .strictObject({
      status: z.enum(["MATCH", "MISMATCH", "MISSING", "INVALID", "STALE"]),
      observedSlot: slot,
      checkedAt: time,
    })
    .nullable(),
});
export const artworkProvenanceResponseSchema = z
  .strictObject({
    kathaId: kathaIdSchema,
    attribution: z.strictObject({
      artist: publicArtworkSummarySchema.shape.artist,
      creatorWallet: walletAddressSchema.nullable(),
    }),
    chain: z.strictObject({
      cluster: z.enum(["LOCALNET", "DEVNET"]),
      registryRecordAddress: walletAddressSchema.nullable(),
      collectionAddress: walletAddressSchema.nullable(),
      coreAssetAddress: walletAddressSchema.nullable(),
    }),
    items: z.array(publicProvenanceEventSchema).max(100),
    pagination: paginationResponseSchema,
    indexing: provenanceIndexingSchema,
  })
  .refine(({ items, pagination }) => items.length <= pagination.limit);
export type ArtworkProvenanceResponse = z.infer<typeof artworkProvenanceResponseSchema>;
