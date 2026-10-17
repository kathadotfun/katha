import { z } from "zod";
import { walletAddressSchema } from "./artwork-domain.js";
import { kathaIdSchema } from "./artwork-identity.js";
import {
  DEFAULT_MARKETPLACE_FEES,
  marketplaceFeeScheduleSchema,
} from "./marketplace.js";

const publicAddress = walletAddressSchema.refine(
  (value) => value !== "11111111111111111111111111111111",
  "A non-default public address is required",
);
export const devnetBootstrapSchema = z.strictObject({
  cluster: z.literal("devnet"),
  operator: publicAddress,
  collection: publicAddress,
  collectionUri: z.url().refine((value) => {
    const uri = new URL(value);
    return (
      uri.protocol === "https:" &&
      !uri.username &&
      !uri.password &&
      !uri.hash &&
      !uri.search
    );
  }, "Use a public HTTPS collection document without credentials or query parameters"),
  registrationAuthority: publicAddress,
  verifierAuthority: publicAddress,
  custodyAuthority: publicAddress,
  treasury: publicAddress,
  paymentMint: publicAddress,
  feeRates: marketplaceFeeScheduleSchema.default(DEFAULT_MARKETPLACE_FEES),
  upgrade: z
    .strictObject({
      buffer: publicAddress,
      spill: publicAddress,
      binarySha256: z.string().regex(/^[0-9a-f]{64}$/),
      binaryBytes: z
        .number()
        .int()
        .min(4)
        .max(10 * 1024 * 1024),
    })
    .optional(),
});
export type DevnetBootstrap = z.infer<typeof devnetBootstrapSchema>;
export const devnetSaleTermsSchema = z.strictObject({
  kathaId: kathaIdSchema,
  artistPayout: publicAddress,
});
export type DevnetSaleTerms = z.infer<typeof devnetSaleTermsSchema>;
export const devnetBootstrapSteps = [
  "collection",
  "registry",
  "marketplace",
  "fees",
  "update-fees",
  "sale-terms",
  "upgrade-registry",
  "upgrade-marketplace",
] as const;
export type DevnetBootstrapStep = (typeof devnetBootstrapSteps)[number];
