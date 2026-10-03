import type { Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { createReadiness } from "../src/readiness.js";
import {
  createShutdown,
  HTTP_DRAIN_TIMEOUT_MS,
  DATABASE_CLOSE_TIMEOUT_MS,
} from "../src/shutdown.js";

afterEach(() => vi.useRealTimers());
function fixture(closeDatabase = vi.fn(async () => {})) {
  let complete!: (error?: Error) => void;
  const server: Pick<Server, "close" | "closeAllConnections"> = {
    close: vi.fn((callback) => {
      complete = callback!;
      return server as Server;
    }),
    closeAllConnections: vi.fn(),
  };
  const readiness = createReadiness(async () => {});
  return {
    server,
    readiness,
    closeDatabase,
    finish: (error?: Error) => complete(error),
    stop: createShutdown(server, readiness, closeDatabase),
  };
}

it("marks unavailable immediately, drains HTTP then closes the pool once across repeated signals", async () => {
  const f = fixture();
  const first = f.stop();
  expect(f.stop()).toBe(first);
  expect(await f.readiness.check()).toBe(false);
  expect(f.closeDatabase).not.toHaveBeenCalled();
  f.finish();
  expect(await first).toBe(true);
  expect(f.server.close).toHaveBeenCalledTimes(1);
  expect(f.closeDatabase).toHaveBeenCalledTimes(1);
  expect(f.server.closeAllConnections).not.toHaveBeenCalled();
});

it("forces overdue HTTP connections closed before database cleanup and reports failure", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const result = f.stop();
  await vi.advanceTimersByTimeAsync(HTTP_DRAIN_TIMEOUT_MS);
  expect(await result).toBe(false);
  expect(f.server.closeAllConnections).toHaveBeenCalledTimes(1);
  expect(f.closeDatabase).toHaveBeenCalledTimes(1);
  f.finish();
  expect(vi.getTimerCount()).toBe(0);
});

it("still closes the database after an HTTP close error", async () => {
  const f = fixture();
  const result = f.stop();
  f.finish(new Error("SYNTHETIC_PRIVATE_ERROR"));
  expect(await result).toBe(false);
  expect(f.closeDatabase).toHaveBeenCalledTimes(1);
});

it("reports pool cleanup rejection without leaking its error", async () => {
  const f = fixture(
    vi.fn(async () => {
      throw new Error("SYNTHETIC_PRIVATE_ERROR");
    }),
  );
  const result = f.stop();
  f.finish();
  expect(await result).toBe(false);
});

it("bounds a stuck database cleanup", async () => {
  vi.useFakeTimers();
  const f = fixture(vi.fn(() => new Promise<void>(() => {})));
  const result = f.stop();
  f.finish();
  await vi.advanceTimersByTimeAsync(DATABASE_CLOSE_TIMEOUT_MS);
  expect(await result).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("closes the pool even if initiating HTTP close throws", async () => {
  const f = fixture();
  vi.mocked(f.server.close).mockImplementation(() => {
    throw new Error("private");
  });
  expect(await f.stop()).toBe(false);
  expect(f.closeDatabase).toHaveBeenCalledTimes(1);
});
