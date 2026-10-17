import { z } from "zod";
import { walletAddressSchema } from "./artwork-domain.js";

export const OPERATOR_ROLES = Object.freeze({
  catalog: 1,
  artistVerifier: 2,
  registrar: 4,
  artworkVerifier: 8,
  custody: 16,
  inventorySales: 32,
  guardian: 64,
});
export const operatorRoleSchema = z.enum(
  Object.keys(OPERATOR_ROLES) as [
    keyof typeof OPERATOR_ROLES,
    ...(keyof typeof OPERATOR_ROLES)[],
  ],
);
const publicAddress = walletAddressSchema.refine(
  (value) => value !== "11111111111111111111111111111111",
);
export const governanceSetupSchema = z
  .strictObject({
    cluster: z.literal("devnet"),
    multisig: publicAddress,
    members: z
      .tuple([publicAddress, publicAddress, publicAddress])
      .refine((values) => new Set(values).size === 3),
    vaultIndex: z.number().int().min(0).max(255),
    timeLockSeconds: z.number().int().min(0).max(7776000),
    grants: z
      .array(
        z.strictObject({
          wallet: publicAddress,
          roles: z
            .array(operatorRoleSchema)
            .min(1)
            .max(7)
            .refine((values) => new Set(values).size === values.length),
          expiresAt: z
            .string()
            .regex(/^(0|[1-9][0-9]{0,18})$/)
            .refine((value) => BigInt(value) <= 0x7fff_ffff_ffff_ffffn),
        }),
      )
      .min(3)
      .max(20)
      .refine(
        (values) => new Set(values.map((value) => value.wallet)).size === values.length,
      ),
  })
  .superRefine((value, context) => {
    const allRoles = value.grants.reduce(
      (mask, grant) =>
        mask | grant.roles.reduce((bits, role) => bits | OPERATOR_ROLES[role], 0),
      0,
    );
    if ((allRoles & 63) !== 63)
      context.addIssue({
        code: "custom",
        message: "Assign all six lifecycle roles before activation",
      });
    if (value.grants.some((grant) => value.members.includes(grant.wallet)))
      context.addIssue({
        code: "custom",
        message: "Use separate governance and operational wallets",
      });
    if (
      !value.grants.some(
        (registrar) =>
          registrar.roles.includes("registrar") &&
          value.grants.some(
            (verifier) =>
              verifier.wallet !== registrar.wallet &&
              verifier.roles.includes("artworkVerifier"),
          ),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Provide distinct registrar and artwork verifier wallets",
      });
  });
export type GovernanceSetup = z.infer<typeof governanceSetupSchema>;
