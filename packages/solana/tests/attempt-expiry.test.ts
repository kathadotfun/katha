import { describe, expect, it, vi } from "vitest";

import {
  ATTEMPT_EXPIRY_MARGIN_BLOCKS,
  createAttemptExpiryReaderFromRpc,
} from "../src/attempt-expiry.js";

const DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const SIGNATURE =
  "4AiN3BZRXfmF77Lxry1brUi95aZJ3QbD7n5TVMCfJg5rh6CC5LRVHmUqUj8zviwDw3DaskaYDwMrYPcJPVZjNqV3";
const LAST_VALID = 1_000n;

function rpc(
  options: {
    genesis?: string;
    height?: bigint;
    status?: unknown;
    statusSlot?: bigint;
  } = {},
) {
  const calls: string[] = [];
  const request = <T>(name: string, value: () => T) => ({
    send: vi.fn(async () => {
      calls.push(name);
      return value();
    }),
  });
  const client = {
    getGenesisHash: () => request("genesis", () => options.genesis ?? DEVNET),
    getSlot: () => request("slot", () => 5_000n),
    getBlockHeight: () =>
      request(
        "height",
        () => options.height ?? LAST_VALID + ATTEMPT_EXPIRY_MARGIN_BLOCKS + 1n,
      ),
    getSignatureStatuses: () =>
      request("status", () => ({
        context: { slot: options.statusSlot ?? 5_000n },
        value: [options.status ?? null],
      })),
  };
  return {
    calls,
    read: createAttemptExpiryReaderFromRpc(client as never, "devnet"),
  };
}

describe("signed attempt expiry", () => {
  it("expires only after finalized height passes the lifetime and history has no signature", async () => {
    const { read, calls } = rpc();
    expect(await read(SIGNATURE, LAST_VALID)).toBe(true);
    // Height must be read before status so an in-time landing is always visible.
    expect(calls).toEqual(["genesis", "slot", "height", "status"]);
  });

  it("keeps attempts unknown while the blockhash may still land", async () => {
    for (const height of [LAST_VALID, LAST_VALID + ATTEMPT_EXPIRY_MARGIN_BLOCKS]) {
      const { read, calls } = rpc({ height });
      expect(await read(SIGNATURE, LAST_VALID)).toBe(false);
      expect(calls).not.toContain("status");
    }
  });

  it("never expires a signature the chain has recorded", async () => {
    const { read } = rpc({
      status: { slot: 4_000n, confirmationStatus: "finalized", err: null },
    });
    expect(await read(SIGNATURE, LAST_VALID)).toBe(false);
  });

  it("rejects status answers from a context behind the observed finalized slot", async () => {
    const { read } = rpc({ statusSlot: 4_999n });
    expect(await read(SIGNATURE, LAST_VALID)).toBe(false);
  });

  it("refuses evidence from another network", async () => {
    const { read } = rpc({ genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" });
    await expect(read(SIGNATURE, LAST_VALID)).rejects.toThrow();
  });
});
