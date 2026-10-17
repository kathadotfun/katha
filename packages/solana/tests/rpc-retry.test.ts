import { afterEach, expect, it, vi } from "vitest";
import { SolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit";
import { retryRpcRead } from "../src/rpc-retry.js";

afterEach(() => vi.useRealTimers());

function httpError(statusCode: number, retryAfter?: string) {
  return new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    statusCode,
    message: "Synthetic provider failure",
    headers: new Headers(retryAfter === undefined ? {} : { "retry-after": retryAfter }),
  });
}

it("returns a successful read unchanged without scheduling another request", async () => {
  const result = { value: 17n };
  const read = vi.fn(async () => result);
  expect(await retryRpcRead(read)).toBe(result);
  expect(read).toHaveBeenCalledTimes(1);
});

it("honors a provider cooldown before retrying an HTTP 429", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(httpError(429, "2")).mockResolvedValue(17);
  const result = retryRpcRead(read);
  await vi.advanceTimersByTimeAsync(1999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe(17);
  expect(read).toHaveBeenCalledTimes(2);
});

it("accepts an HTTP-date Retry-After value", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
  const read = vi
    .fn()
    .mockRejectedValueOnce(httpError(503, "Sun, 18 Oct 2026 00:00:03 GMT"))
    .mockResolvedValue("ok");
  const result = retryRpcRead(read);
  await vi.advanceTimersByTimeAsync(2999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe("ok");
});

it("bounds transient reads to five attempts and returns the original failure", async () => {
  vi.useFakeTimers();
  const error = httpError(503);
  const read = vi.fn().mockRejectedValue(error);
  const rejected = expect(retryRpcRead(read)).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(read).toHaveBeenCalledTimes(5);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([400, 401, 403, 404])(
  "does not retry HTTP %s configuration/access failures",
  async (status) => {
    const error = httpError(status);
    const read = vi.fn().mockRejectedValue(error);
    await expect(retryRpcRead(read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  },
);

it("does not retry malformed chain evidence", async () => {
  const error = new TypeError("Invalid account binding");
  const read = vi.fn().mockRejectedValue(error);
  await expect(retryRpcRead(read)).rejects.toBe(error);
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(["31", "9".repeat(400)])(
  "does not shorten a provider cooldown exceeding the read bound",
  async (header) => {
    vi.useFakeTimers();
    const error = httpError(429, header);
    const read = vi.fn().mockRejectedValue(error);
    await expect(retryRpcRead(read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("uses bounded backoff for a malformed Retry-After header", async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(httpError(429, "invalid"))
    .mockResolvedValue(1);
  const result = retryRpcRead(read);
  await vi.advanceTimersByTimeAsync(999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe(1);
});

it("aborts a cooldown immediately and leaves no pending retry", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = vi.fn().mockRejectedValue(httpError(429, "10"));
  const error = new Error("Synthetic cancellation");
  const rejected = expect(retryRpcRead(read, controller.signal)).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort(error);
  await rejected;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not start a read after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const read = vi.fn();
  await expect(retryRpcRead(read, controller.signal)).rejects.toBe(
    controller.signal.reason,
  );
  expect(read).not.toHaveBeenCalled();
});
