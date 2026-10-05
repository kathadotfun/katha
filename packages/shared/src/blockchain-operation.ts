import { z } from "zod";
import { kathaIdSchema } from "./artwork-identity.js";
import { walletAddressSchema } from "./artwork-domain.js";
import { walletClusterSchema } from "./wallet-session.js";
import { tokenAmountSchema } from "./marketplace.js";

export const registryOperationKindSchema = z.enum([
  "REGISTER_ARTWORK",
  "VERIFY_ARTWORK",
  "RECORD_CONDITION",
  "UPDATE_CUSTODY",
  "MINT_ARTWORK",
  "REVISE_METADATA",
]);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const operationIntentSchema = z.strictObject({
  artworkId: z.uuid(),
  kathaId: kathaIdSchema,
  kind: registryOperationKindSchema,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  expectedAccounts: z
    .array(walletAddressSchema)
    .min(1)
    .max(64)
    .refine((values) => new Set(values).size === values.length),
  expectedHashes: z.array(hash).max(32),
  // Internal callers supply only already validated domain inputs, never raw HTTP JSON.
  parameters: z.record(z.string().min(1).max(100), z.json()),
});
// Internal canonical preparation shape; receipt validation compares compiled privileges.
export const preparedInstructionSchema = z.strictObject({
  programAddress: walletAddressSchema,
  accounts: z
    .array(
      z.strictObject({
        address: walletAddressSchema,
        role: z.number().int().min(0).max(3),
      }),
    )
    .min(1)
    .max(64),
  dataHex: z
    .string()
    .min(16)
    .max(8192)
    .regex(/^(?:[0-9a-f]{2})+$/),
});
export const unsignedOperationResponseSchema = z.strictObject({
  operationId: z.uuid(),
  preparationId: z.uuid(),
  kathaId: kathaIdSchema,
  kind: registryOperationKindSchema,
  cluster: walletClusterSchema,
  status: z.literal("PREPARED"),
  requestHash: hash,
  messageHash: hash,
  transactionBase64: z
    .string()
    .min(1)
    .max(5464)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  transactionVersion: z.union([z.literal(0), z.literal(1)]),
  feePayer: walletAddressSchema,
  requiredSignerAddresses: z.array(walletAddressSchema).length(1),
  blockhash: walletAddressSchema,
  lastValidBlockHeight: tokenAmountSchema,
  simulation: z.strictObject({
    slot: tokenAmountSchema,
    unitsConsumed: tokenAmountSchema.nullable(),
  }),
});
export type OperationIntent = z.infer<typeof operationIntentSchema>;
export type UnsignedOperationResponse = z.infer<typeof unsignedOperationResponseSchema>;
