import type { ArtworkWorkflowStore, WorkflowOperationKind } from "@katha/db";
import {
  artworkDraftParamsSchema,
  artworkWorkflowResponseSchema,
  type ArtworkWorkflowState,
} from "@katha/shared";
import { DomainError } from "./errors.js";

export function createArtworkWorkflow(store: ArtworkWorkflowStore) {
  return {
    async read(kathaId: string) {
      const path = artworkDraftParamsSchema.safeParse({ kathaId });
      if (!path.success) throw new DomainError("INVALID_REQUEST");
      const facts = await store.read(path.data.kathaId);
      if (!facts) throw new DomainError("NOT_FOUND");
      const chain = (
        kind: WorkflowOperationKind,
        started = false,
      ): ArtworkWorkflowState => {
        const operation = facts.operations[kind];
        if (operation?.finalized) return "COMPLETE";
        return operation?.open || started ? "PENDING" : "NOT_STARTED";
      };
      return artworkWorkflowResponseSchema.parse({
        kathaId: path.data.kathaId,
        minted: facts.operations.MINT_ARTWORK?.finalized ?? false,
        published: facts.published,
        steps: {
          // A saved draft exists, so documentation is at least started.
          documentation: facts.hasEvidence ? "COMPLETE" : "PENDING",
          registration: chain("REGISTER_ARTWORK", facts.hasMetadataDocument),
          verification: chain("VERIFY_ARTWORK"),
          condition: chain("RECORD_CONDITION"),
          custody: chain("UPDATE_CUSTODY"),
          media: facts.media.publicHero
            ? "COMPLETE"
            : facts.media.any
              ? "PENDING"
              : "NOT_STARTED",
          minting: facts.published
            ? "COMPLETE"
            : facts.operations.MINT_ARTWORK
              ? "PENDING"
              : "NOT_STARTED",
          metadata: chain("REVISE_METADATA"),
        },
      });
    },
  };
}
export type ArtworkWorkflowBoundary = ReturnType<typeof createArtworkWorkflow>;
