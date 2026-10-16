import type { ArtworkRegistrationReview } from "@katha/shared";

type LatestReceipt = ArtworkRegistrationReview["registration"]["receipt"];

// Operations are append-only: a failed or expired attempt closes its idempotency key.
// A retry derives a new key from that failed signature, so repeated clicks for the same
// retry still share one key while each later failure opens exactly one fresh attempt.
// The short suffix keeps the longest (mint) key within the 128-character limit.
export function operationIdempotencyKey(base: string, latest: LatestReceipt) {
  return latest?.status === "FAILED"
    ? `${base}-r${latest.signature.slice(0, 10)}`
    : base;
}
