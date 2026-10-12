import { z } from "zod";
import { kathaIdSchema } from "./artwork-identity.js";

// Tab markers for the operations workspace, derived from Katha's own records.
// COMPLETE means a finalized record exists; PENDING means work was started
// (a draft, prepared document or unresolved transaction) but isn't finalized.
// This is navigation help only; each workflow page states its own exact status.
export const artworkWorkflowStepSchema = z.enum([
  "documentation",
  "registration",
  "verification",
  "condition",
  "custody",
  "media",
  "minting",
  "metadata",
]);
export const artworkWorkflowStateSchema = z.enum([
  "COMPLETE",
  "PENDING",
  "NOT_STARTED",
]);
export const artworkWorkflowResponseSchema = z.strictObject({
  kathaId: kathaIdSchema,
  // The minting tab covers two milestones; these keep them distinct.
  minted: z.boolean(),
  published: z.boolean(),
  steps: z.strictObject(
    Object.fromEntries(
      artworkWorkflowStepSchema.options.map((step) => [
        step,
        artworkWorkflowStateSchema,
      ]),
    ) as Record<
      z.infer<typeof artworkWorkflowStepSchema>,
      typeof artworkWorkflowStateSchema
    >,
  ),
});
export type ArtworkWorkflowStep = z.infer<typeof artworkWorkflowStepSchema>;
export type ArtworkWorkflowState = z.infer<typeof artworkWorkflowStateSchema>;
export type ArtworkWorkflowResponse = z.infer<typeof artworkWorkflowResponseSchema>;
