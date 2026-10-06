import type { NfcResolutionStore } from "@katha/db";
import { kathaIdSchema, nfcTagParamsSchema } from "@katha/shared";
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
  return {
    async resolve(value: string) {
      const parsed = nfcTagParamsSchema.safeParse({ tagId: value });
      if (!parsed.success) throw new DomainError("INVALID_REQUEST");
      const record = await store.find(parsed.data.tagId);
      if (!record) throw new DomainError("NOT_FOUND");
      // Treat corrupt read models as failures, never as redirect destinations.
      const identity = kathaIdSchema.parse(record.kathaId);
      if (
        record.tagId !== parsed.data.tagId ||
        (record.retiredAt !== null &&
          (!(record.retiredAt instanceof Date) ||
            !Number.isFinite(record.retiredAt.getTime())))
      )
        throw new Error("Invalid NFC binding");
      if (record.retiredAt !== null) throw new DomainError("NFC_TAG_RETIRED");
      return new URL(`/art/${identity}`, origin.origin).href;
    },
  };
}
export type NfcResolutionBoundary = ReturnType<typeof createNfcResolution>;
