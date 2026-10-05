import { z } from "zod";
import { metadataDocumentSchema } from "./document-preparation.js";
import { publicArtworkSummarySchema } from "./artwork-discovery-api.js";
import { artworkDraftResponseSchema } from "./artwork-draft-api.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { physicalCustodyStateSchema } from "./artwork-lifecycle.js";
import { conditionGradeSchema, conditionReasonSchema } from "./condition-report.js";
import { kathaIdSchema } from "./artwork-identity.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const slot = z.string().regex(/^(0|[1-9][0-9]*)$/);
const time = z.iso.datetime({ precision: 3 });
const receipt = z.strictObject({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/),
  slot,
  recordedAt: time,
});
const commitment = { documentHash: hash, transaction: receipt };
export const artworkDetailParamsSchema = z.strictObject({ kathaId: kathaIdSchema });
export const artworkDetailQuerySchema = z.strictObject({});
export const publicArtworkDetailSchema = z
  .strictObject({
    kathaId: publicArtworkSummarySchema.shape.kathaId,
    category: publicArtworkSummarySchema.shape.category,
    title: publicArtworkSummarySchema.shape.title,
    creationYear: publicArtworkSummarySchema.shape.creationYear,
    artist: publicArtworkSummarySchema.shape.artist,
    creatorWallet: walletAddressSchema.nullable(),
    dimensions: artworkDraftResponseSchema.shape.dimensions,
    origin: artworkDraftResponseSchema.shape.origin,
    technique: artworkDraftResponseSchema.shape.technique,
    story: artworkDraftResponseSchema.shape.story,
    meaning: artworkDraftResponseSchema.shape.meaning,
    culturalContext: artworkDraftResponseSchema.shape.culturalContext,
    creationProcess: artworkDraftResponseSchema.shape.creationProcess,
    materials: z.array(z.string().trim().min(1).max(120)),
    media: z.array(
      z.strictObject({
        id: z.uuid(),
        kind: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]),
        role: z.enum([
          "HERO",
          "FRONT",
          "BACK",
          "DETAIL",
          "ARTIST",
          "PROCESS",
          "CERTIFICATE",
          "CONDITION",
          "DOCUMENTARY",
          "OTHER",
        ]),
        position: z.number().int().nonnegative(),
        contentHash: hash,
        mimeType: z.string().min(1).max(100),
        altText: z.string().min(1).max(500).nullable(),
      }),
    ),
    verification: z.strictObject({
      status: z.literal("VERIFIED"),
      verifierWallet: walletAddressSchema,
      inspectedAt: time,
      ...commitment,
    }),
    metadata: z.strictObject({
      version: z.number().int().min(1).max(4294967295),
      uri: metadataDocumentSchema.shape.image,
      ...commitment,
    }),
    condition: z.strictObject({
      version: z.number().int().min(1).max(4294967295),
      grade: conditionGradeSchema,
      reason: conditionReasonSchema,
      inspectedAt: time,
      verifierWallet: walletAddressSchema,
      ...commitment,
    }),
    custody: z.strictObject({
      state: physicalCustodyStateSchema,
      source: z.enum(["MANUAL_OBSERVATION", "UNKNOWN"]),
      observedAt: time.nullable(),
    }),
    ownership: z.strictObject({
      ownerWallet: walletAddressSchema,
      source: z.literal("INDEXED_CORE"),
      observedAt: time,
      transaction: receipt,
    }),
    chain: z.strictObject({
      cluster: z.enum(["LOCALNET", "DEVNET"]),
      coreAssetAddress: walletAddressSchema,
      registryRecordAddress: walletAddressSchema.nullable(),
      collectionAddress: walletAddressSchema.nullable(),
    }),
    indexing: z.strictObject({
      freshness: z.enum(["UNKNOWN", "GAP_DETECTED"]),
      checkpoint: z
        .strictObject({
          programAddress: walletAddressSchema,
          scannedThroughSlot: slot.nullable(),
          gapFromSlot: slot.nullable(),
          gapThroughSlot: slot.nullable(),
          updatedAt: time,
        })
        .nullable(),
    }),
  })
  .refine((record) => record.kathaId.startsWith(`KATHA-${record.category}-`), {
    path: ["kathaId"],
    error: "Category must match permanent ID",
  });
export type PublicArtworkDetail = z.infer<typeof publicArtworkDetailSchema>;
