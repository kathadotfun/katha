import { expect, it, vi } from "vitest";
import {
  CORE_PROGRAM_ADDRESS,
  type ActivityPage,
  type ActivityPageRequest,
} from "@katha/solana";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "@katha/solana/registry";
import { pollActivityPages, runActivityPoller } from "../src/activity-poller.js";
import { createLogger } from "../src/logger.js";
const page = (
  programAddress = KATHA_REGISTRY_PROGRAM_ADDRESS as ActivityPage["programAddress"],
): ActivityPage => ({
  cluster: "localnet",
  programAddress,
  headSignature: null,
  nextBefore: null,
  transactions: [],
});
it("waits for consumption before reading another stream", async () => {
  const order: string[] = [];
  const read = vi.fn(async (request: ActivityPageRequest) => {
    order.push(`read:${request.programAddress}`);
    return page(request.programAddress);
  });
  const consume = vi.fn(async (p: ActivityPage) => {
    await Promise.resolve();
    order.push(`consume:${p.programAddress}`);
  });
  await pollActivityPages(
    read,
    [
      { programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
      { programAddress: CORE_PROGRAM_ADDRESS },
    ],
    consume,
  );
  expect(order).toEqual([
    `read:${KATHA_REGISTRY_PROGRAM_ADDRESS}`,
    `consume:${KATHA_REGISTRY_PROGRAM_ADDRESS}`,
    `read:${CORE_PROGRAM_ADDRESS}`,
    `consume:${CORE_PROGRAM_ADDRESS}`,
  ]);
});
it("does not consume or advance after a read failure", async () => {
  const read = vi.fn(async () => {
      throw new Error("unavailable");
    }),
    consume = vi.fn();
  await expect(
    pollActivityPages(
      read,
      [{ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS }],
      consume,
    ),
  ).rejects.toThrow("unavailable");
  expect(consume).not.toHaveBeenCalled();
});
it("stops before the next stream when consumption fails", async () => {
  const read = vi.fn(async () => page());
  const consume = vi.fn(async () => {
    throw new Error("database rollback");
  });
  await expect(
    pollActivityPages(
      read,
      [
        { programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
        { programAddress: CORE_PROGRAM_ADDRESS },
      ],
      consume,
    ),
  ).rejects.toThrow("database rollback");
  expect(read).toHaveBeenCalledTimes(1);
});
it("honors abort between reading and consumption", async () => {
  const c = new AbortController();
  const read = vi.fn(async () => {
      c.abort();
      return page();
    }),
    consume = vi.fn();
  await expect(
    pollActivityPages(
      read,
      [{ programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS }],
      consume,
      c.signal,
    ),
  ).rejects.toThrow();
  expect(consume).not.toHaveBeenCalled();
});
it("rejects duplicate stream requests", async () => {
  const read = vi.fn(async () => page());
  await expect(
    pollActivityPages(
      read,
      [
        { programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
        { programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
      ],
      vi.fn(),
    ),
  ).rejects.toThrow("Invalid activity streams");
  expect(read).not.toHaveBeenCalled();
});
it("reads new consumer-selected cursors each cycle and shuts down while idle", async () => {
  const c = new AbortController();
  let cycles = 0;
  const requests = vi.fn(async () => [
    { programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
  ]);
  const read = vi.fn(async () => page());
  await runActivityPoller({
    read,
    requests,
    consume: async () => {
      if (++cycles === 2) c.abort();
    },
    signal: c.signal,
    intervalMs: 100,
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(requests).toHaveBeenCalledTimes(2);
});
it("stops on unresolved evidence without silently retrying or changing cursors", async () => {
  const c = new AbortController();
  const read = vi.fn(async () => {
    throw new Error("gap");
  });
  const requests = vi.fn(async () => [
    { programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS },
  ]);
  await expect(
    runActivityPoller({ read, requests, consume: vi.fn(), signal: c.signal }),
  ).rejects.toThrow("gap");
  expect(requests).toHaveBeenCalledTimes(1);
});
it("logs only fixed summaries and redacts polling failures", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => {
    lines.push(line);
  });
  logger.activityPageObserved({
    cluster: "localnet",
    transactions: 2,
    activities: 3,
    ...{ wire: "synthetic private intent", rpc: "synthetic RPC secret" },
  });
  logger.activityPollingFailed();
  expect(lines.join()).not.toContain("synthetic");
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "activity_page_observed",
    transactions: 2,
    activities: 3,
  });
  expect(JSON.parse(lines[1]!)).toMatchObject({
    event: "activity_polling_failed",
    level: "error",
  });
});
it("classifies polling failures without messages, URLs or unbounded fields", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => {
    lines.push(line);
  });
  const rpc = Object.assign(
    new Error("https://rpc.example/synthetic-secret-key failed"),
    { name: "SolanaError", context: { __code: 8100002, url: "synthetic-secret-key" } },
  );
  logger.activityPollingFailed(rpc);
  logger.activityPollingFailed(
    Object.assign(new Error("synthetic"), { reason: "PAGE_LIMIT" }),
  );
  logger.activityPollingFailed(
    Object.assign(new Error("synthetic"), { name: "synthetic secret name!" }),
  );
  expect(lines.join()).not.toContain("synthetic");
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "activity_polling_failed",
    errorName: "SolanaError",
    rpcErrorCode: 8100002,
  });
  expect(JSON.parse(lines[1]!)).toMatchObject({
    errorName: "Error",
    gapReason: "PAGE_LIMIT",
  });
  expect(JSON.parse(lines[2]!).errorName).toBeUndefined();
});
