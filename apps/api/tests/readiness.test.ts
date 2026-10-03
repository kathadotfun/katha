import { afterEach, expect, it, vi } from "vitest";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { createReadiness, READINESS_TIMEOUT_MS } from "../src/readiness.js";

afterEach(() => vi.useRealTimers());
const silent = createLogger(() => {});

it("keeps liveness independent from missing and unavailable database state", async () => {
  const check = vi.fn().mockRejectedValue(new Error("SYNTHETIC_PRIVATE_URL"));
  for (const readiness of [undefined, createReadiness(check)]) {
    const app = createApi(silent, readiness);
    const live = await app.request("/health/live");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "alive" });
    expect(check).not.toHaveBeenCalled();
    const ready = await app.request("/health/ready");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "unavailable" });
    expect(ready.headers.get("Cache-Control")).toBe("no-store");
    expect(ready.headers.get("X-Request-Id")).toBeTruthy();
  }
});

it("probes again after failure and after success instead of caching stale readiness", async () => {
  const check = vi
    .fn()
    .mockRejectedValueOnce(new Error("private"))
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("private"));
  const app = createApi(silent, createReadiness(check));
  for (const status of [503, 200, 503])
    expect((await app.request("/health/ready")).status).toBe(status);
  expect(check).toHaveBeenCalledTimes(3);
});

it("bounds caller waiting while sharing the actual hung probe without queueing more work", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const check = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const readiness = createReadiness(check);
  const first = readiness.check();
  const second = readiness.check();
  await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
  expect(await first).toBe(false);
  expect(await second).toBe(false);
  const third = readiness.check();
  await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
  expect(await third).toBe(false);
  expect(check).toHaveBeenCalledTimes(1);
  resolve();
  await vi.advanceTimersByTimeAsync(0);
  check.mockResolvedValue(undefined);
  expect(await readiness.check()).toBe(true);
  expect(check).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("reports unavailable during shutdown even if an earlier probe succeeds", async () => {
  let resolve!: () => void;
  const check = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const readiness = createReadiness(check);
  const inFlight = readiness.check();
  await Promise.resolve();
  readiness.stop();
  resolve();
  expect(await inFlight).toBe(false);
  expect(await readiness.check()).toBe(false);
  expect(check).toHaveBeenCalledTimes(1);
});
