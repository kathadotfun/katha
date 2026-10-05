import type { ActivityReader, ActivityPage, ActivityPageRequest } from "@katha/solana";
import { setTimeout } from "node:timers/promises";

/** Cursor selection and durable acknowledgement belong to the consuming store. */
export async function pollActivityPages(
  read: ActivityReader,
  requests: readonly ActivityPageRequest[],
  consume: (page: ActivityPage) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (
    requests.length > 2 ||
    new Set(requests.map((r) => r.programAddress)).size !== requests.length
  )
    throw new Error("Invalid activity streams");
  for (const request of requests) {
    signal?.throwIfAborted();
    const page = await read(request, signal);
    signal?.throwIfAborted();
    await consume(page);
  }
}
export async function runActivityPoller(options: {
  read: ActivityReader;
  requests: () => Promise<readonly ActivityPageRequest[]>;
  consume: (page: ActivityPage) => Promise<void>;
  signal: AbortSignal;
  intervalMs?: number;
}): Promise<void> {
  const intervalMs = options.intervalMs ?? 5000;
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000)
    throw new Error("Invalid polling interval");
  try {
    while (!options.signal.aborted) {
      await pollActivityPages(
        options.read,
        await options.requests(),
        options.consume,
        options.signal,
      );
      await setTimeout(intervalMs, undefined, { signal: options.signal });
    }
  } catch (error) {
    if (!options.signal.aborted) throw error;
  }
}
