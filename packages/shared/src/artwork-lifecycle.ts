import { z } from "zod";

export const artworkRegistrationStateSchema = z.enum(["DRAFT", "REGISTERED"]);
export type ArtworkRegistrationState = z.infer<typeof artworkRegistrationStateSchema>;

export const artworkVerificationStateSchema = z.enum(["UNVERIFIED", "VERIFIED"]);
export type ArtworkVerificationState = z.infer<typeof artworkVerificationStateSchema>;

// UNKNOWN means no physical custody attestation, not possession by an unknown owner.
export const physicalCustodyStateSchema = z.enum([
  "UNKNOWN",
  "KATHA_HELD",
  "COLLECTOR_HELD",
  "IN_TRANSIT",
]);
export type PhysicalCustodyState = z.infer<typeof physicalCustodyStateSchema>;

export const artworkRegistrationTransitionSchema = z.strictObject({
  action: z.literal("REGISTER"),
  from: z.literal("DRAFT"),
  to: z.literal("REGISTERED"),
});
export type ArtworkRegistrationTransition = z.infer<
  typeof artworkRegistrationTransitionSchema
>;

export const artworkVerificationTransitionSchema = z.strictObject({
  action: z.literal("VERIFY_ARTWORK"),
  registration: z.literal("REGISTERED"),
  from: z.literal("UNVERIFIED"),
  to: z.literal("VERIFIED"),
});
export type ArtworkVerificationTransition = z.infer<
  typeof artworkVerificationTransitionSchema
>;

// These name physical movements only; an attestation must also identify the custodian.
export const physicalCustodyTransitionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("ATTEST_KATHA_CUSTODY"),
    from: z.literal("UNKNOWN"),
    to: z.literal("KATHA_HELD"),
  }),
  z.strictObject({
    action: z.literal("ATTEST_COLLECTOR_CUSTODY"),
    from: z.literal("UNKNOWN"),
    to: z.literal("COLLECTOR_HELD"),
  }),
  z.strictObject({
    action: z.literal("DISPATCH_FROM_KATHA"),
    from: z.literal("KATHA_HELD"),
    to: z.literal("IN_TRANSIT"),
  }),
  z.strictObject({
    action: z.literal("DISPATCH_FROM_COLLECTOR"),
    from: z.literal("COLLECTOR_HELD"),
    to: z.literal("IN_TRANSIT"),
  }),
  z.strictObject({
    action: z.literal("RECEIVE_AT_KATHA"),
    from: z.literal("IN_TRANSIT"),
    to: z.literal("KATHA_HELD"),
  }),
  z.strictObject({
    action: z.literal("RECEIVE_BY_COLLECTOR"),
    from: z.literal("IN_TRANSIT"),
    to: z.literal("COLLECTOR_HELD"),
  }),
]);
export type PhysicalCustodyTransition = z.infer<typeof physicalCustodyTransitionSchema>;
