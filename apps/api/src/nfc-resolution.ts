import type { NfcResolutionStore } from "@katha/db";
import {
  kathaIdSchema,
  nfcTagParamsSchema,
  nfcTagStatusResponseSchema,
  type NfcTagStatusResponse,
} from "@katha/shared";
import { DomainError } from "./errors.js";

export function createNfcResolution(store: NfcResolutionStore, appOrigin: string) {
  const origin = new URL(appOrigin);
  if (
    appOrigin !== appOrigin.trim() ||
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.origin === "null"
  )
    throw new Error("Invalid NFC application origin");
  function tagId(value: string) {
    const parsed = nfcTagParamsSchema.safeParse({ tagId: value });
    if (!parsed.success) throw new DomainError("INVALID_REQUEST");
    return parsed.data.tagId;
  }
  async function lookup(value: string) {
    const id = tagId(value);
    const record = await store.find(id);
    if (!record) return { tagId: id, state: "UNKNOWN" as const, kathaId: null };
    // Treat corrupt read models as failures, never as redirect destinations.
    const identity = kathaIdSchema.parse(record.kathaId);
    if (
      record.tagId !== id ||
      typeof record.published !== "boolean" ||
      (record.retiredAt !== null &&
        (!(record.retiredAt instanceof Date) ||
          !Number.isFinite(record.retiredAt.getTime())))
    )
      throw new Error("Invalid NFC binding");
    if (record.retiredAt !== null)
      return {
        tagId: id,
        state: "RETIRED" as const,
        kathaId: null,
        published: record.published,
      };
    if (!record.published)
      return { tagId: id, state: "UNPUBLISHED" as const, kathaId: null };
    return { tagId: id, state: "ACTIVE" as const, kathaId: identity };
  }
  return {
    async status(value: string): Promise<NfcTagStatusResponse> {
      const { tagId: id, state, kathaId } = await lookup(value);
      return nfcTagStatusResponseSchema.parse({ tagId: id, state, kathaId });
    },
    // The marker tells the record page the visit came from a tag. It's a hint
    // for wording only; a tap never authenticates the painting.
    async resolve(value: string) {
      const result = await lookup(value);
      if (result.state === "ACTIVE")
        return new URL(`/art/${result.kathaId}?source=nfc`, origin.origin).href;
      if (result.state === "RETIRED" && result.published)
        throw new DomainError("NFC_TAG_RETIRED");
      throw new DomainError("NOT_FOUND");
    },
    // Browsers that tap an unusable tag get a readable page instead of JSON.
    tagPage(value: string) {
      return new URL(`/tags/${tagId(value)}`, origin.origin).href;
    },
  };
}
export type NfcResolutionBoundary = ReturnType<typeof createNfcResolution>;
