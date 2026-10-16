import assert from "node:assert/strict";
import { test } from "node:test";
import { operationIdempotencyKey } from "../lib/operation-retry.ts";

const base =
  "register-bbbbbbbb-1111-4111-8111-111111111111-cccccccc-1111-4111-8111-111111111111";
const receipt = (status: "UNKNOWN" | "FAILED" | "FINALIZED", signature: string) => ({
  status,
  signature,
  slot: status === "FINALIZED" ? "12" : null,
  indexed: false,
});

test("retries after a failed attempt use a fresh key derived from that signature", () => {
  const first =
    "4AiN3BZRXfmF77Lxry1brUi95aZJ3QbD7n5TVMCfJg5rh6CC5LRVHmUqUj8zviwDw3DaskaYDwMrYPcJPVZjNqV3";
  const second =
    "5bbhqYkU2yQGGcwn6RGjN5Gn13tnXT5jaJQS7PdPgU4V2Tw8mpNGTcawqy8RqXPAmqRioab19gUSuu1WbXZosHt7";
  assert.equal(operationIdempotencyKey(base, null), base);
  const retry = operationIdempotencyKey(base, receipt("FAILED", first));
  assert.equal(retry, `${base}-r4AiN3BZRXf`);
  // Repeated clicks for the same retry share a key; a later failure opens another.
  assert.equal(operationIdempotencyKey(base, receipt("FAILED", first)), retry);
  assert.notEqual(operationIdempotencyKey(base, receipt("FAILED", second)), retry);
  assert.match(retry, /^[A-Za-z0-9_-]{1,128}$/);
  const mint = `mint-${"b".repeat(36)}-${"c".repeat(36)}-${"d".repeat(36)}`;
  assert.match(
    operationIdempotencyKey(mint, receipt("FAILED", first)),
    /^[A-Za-z0-9_-]{1,128}$/,
  );
});

test("unknown and finalized attempts never open a fresh key", () => {
  const signature =
    "4AiN3BZRXfmF77Lxry1brUi95aZJ3QbD7n5TVMCfJg5rh6CC5LRVHmUqUj8zviwDw3DaskaYDwMrYPcJPVZjNqV3";
  assert.equal(operationIdempotencyKey(base, receipt("UNKNOWN", signature)), base);
  assert.equal(operationIdempotencyKey(base, receipt("FINALIZED", signature)), base);
});
