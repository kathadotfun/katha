import type { NfcTagRecord, NfcTagStore } from "@katha/db";
import {
  nfcArtworkParamsSchema,
  nfcTagAssignmentRequestSchema,
  nfcTagListResponseSchema,
  nfcTagParamsSchema,
  nfcTagResponseSchema,
  type WalletSession,
} from "@katha/shared";
import { DomainError } from "./errors.js";
function response(record: NfcTagRecord) {
  return nfcTagResponseSchema.parse({
    tagId: record.tagId,
    kathaId: record.kathaId,
    state: record.retiredAt === null ? "ACTIVE" : "RETIRED",
    assignedAt: record.assignedAt.toISOString(),
    retiredAt: record.retiredAt?.toISOString() ?? null,
  });
}
export function createNfcTags(store: NfcTagStore) {
  function tagId(value: string) {
    const parsed = nfcTagParamsSchema.safeParse({ tagId: value });
    if (!parsed.success) throw new DomainError("INVALID_REQUEST");
    return parsed.data.tagId;
  }
  return {
    async get(value: string) {
      const record = await store.get(tagId(value));
      if (!record) throw new DomainError("NOT_FOUND");
      return response(record);
    },
    async list(kathaId: string) {
      const path = nfcArtworkParamsSchema.safeParse({ kathaId });
      if (!path.success) throw new DomainError("INVALID_REQUEST");
      const records = await store.listByArtwork(path.data.kathaId);
      if (!records) throw new DomainError("NOT_FOUND");
      return nfcTagListResponseSchema.parse({
        kathaId: path.data.kathaId,
        items: records.map(response),
      });
    },
    async assign(kathaId: string, input: unknown, session: WalletSession) {
      const path = nfcArtworkParamsSchema.safeParse({ kathaId });
      const parsed = nfcTagAssignmentRequestSchema.safeParse(input);
      if (!path.success || !parsed.success) throw new DomainError("INVALID_REQUEST");
      const result = await store.assign(
        path.data.kathaId,
        parsed.data.tagId,
        session.walletId,
      );
      if (result.status === "not_found") throw new DomainError("NOT_FOUND");
      if (result.status !== "assigned") throw new DomainError("CONFLICT");
      return response(result.record);
    },
    async retire(value: string, session: WalletSession) {
      const record = await store.retire(tagId(value), session.walletId);
      if (!record) throw new DomainError("NOT_FOUND");
      return response(record);
    },
  };
}
export type NfcTagsBoundary = ReturnType<typeof createNfcTags>;
