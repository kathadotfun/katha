import { expect, it } from "vitest";
import { z } from "zod";
import {
  apiErrorResponseSchema,
  HTTP_LIMITS,
  kathaIdSchema,
  paginationQuerySchema,
  tokenAmountSchema,
} from "@katha/shared";
import { createApi } from "../src/app.js";
import { createLogger } from "../src/logger.js";
import { parseJson, parseParams, parseQuery } from "../src/http.js";

const origin = "http://localhost:3000";
function fixture() {
  const logs: string[] = [];
  const app = createApi(
    createLogger((line) => logs.push(line)),
    undefined,
    [origin],
  );
  let calls = 0;
  app.post("/test/:id", async (c) => {
    const params = parseParams(c, z.strictObject({ id: kathaIdSchema }));
    const query = parseQuery(c, paginationQuerySchema);
    const body = await parseJson(c, z.strictObject({ amount: tokenAmountSchema }));
    calls++;
    return c.json({ ...params, ...query, ...body });
  });
  app.post("/test-body", async (c) => {
    calls++;
    return c.json({ bytes: (await c.req.arrayBuffer()).byteLength });
  });
  return { app, logs, calls: () => calls };
}
const path = "/test/KATHA-PAUBHA-000001";
const validBody = JSON.stringify({ amount: "18446744073709551615" });

it("validates path/query/body and returns an exact token amount string", async () => {
  const { app } = fixture();
  const response = await app.request(`${path}?limit=100&offset=100000`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: validBody,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    id: "KATHA-PAUBHA-000001",
    limit: 100,
    offset: 100000,
    amount: "18446744073709551615",
  });
});
it.each([
  ["/test/private-id", validBody, "", 400],
  [path, '{"amount":42}', "", 400],
  [path, '{"amount":"2","private":"secret"}', "", 400],
  [path, "SYNTHETIC_PRIVATE_JSON", "", 400],
  [path, validBody, "?limit=2&limit=3", 400],
  [path, validBody, "?offset=100001", 400],
  [path, validBody, "?unknown=secret", 400],
] as const)(
  "rejects invalid route inputs before side effects",
  async (route, body, query, status) => {
    const f = fixture();
    const response = await f.app.request(route + query, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(status);
    const error = apiErrorResponseSchema.parse(await response.json());
    expect(error.error.code).toBe("INVALID_REQUEST");
    expect(f.calls()).toBe(0);
    expect(f.logs.join("") + JSON.stringify(error)).not.toContain("secret");
    expect(f.logs.join("") + JSON.stringify(error)).not.toContain(
      "SYNTHETIC_PRIVATE_JSON",
    );
  },
);
it.each([
  undefined,
  "text/plain",
  "application/jsonp",
  "application/x-www-form-urlencoded",
])("rejects incorrect JSON media types", async (contentType) => {
  const f = fixture();
  const response = await f.app.request(path, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : {},
    body: validBody,
  });
  expect(response.status).toBe(415);
  expect(f.calls()).toBe(0);
});
it.each([
  "https://evil.example",
  "null",
  "http://localhost:3000.evil.example",
  "http://localhost:3000/",
])("rejects unapproved origins before handlers", async (badOrigin) => {
  const f = fixture();
  const response = await f.app.request("/test-body", {
    method: "POST",
    headers: { Origin: badOrigin },
    body: "private",
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(response.headers.get("Vary")).toContain("Origin");
  expect(f.calls()).toBe(0);
});
it("allows exact configured origins, credentials and exposed request IDs on success and error", async () => {
  const f = fixture();
  for (const route of ["/health/live", "/missing"]) {
    const response = await f.app.request(route, { headers: { Origin: origin } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Request-Id",
    );
    expect(response.headers.get("Vary")).toContain("Origin");
  }
});
it("accepts only approved preflight methods and headers", async () => {
  const f = fixture();
  for (const [method, header, status] of [
    ["POST", "Content-Type, Authorization", 204],
    ["TRACE", "Content-Type", 403],
    ["POST", "X-Private", 403],
  ] as const) {
    const response = await f.app.request(path, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": header,
      },
    });
    expect(response.status).toBe(status);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
  }
  expect(f.calls()).toBe(0);
});
it("supports originless clients without cross-origin response access", async () => {
  const response = await fixture().app.request("/health/live");
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
});
it.each([HTTP_LIMITS.jsonBodyBytes, HTTP_LIMITS.jsonBodyBytes + 1])(
  "enforces actual bytes without Content-Length",
  async (size) => {
    const f = fixture();
    const response = await f.app.request("/test-body", {
      method: "POST",
      body: "x".repeat(size),
    });
    expect(response.status).toBe(size === HTTP_LIMITS.jsonBodyBytes ? 200 : 413);
  },
);
it("enforces streamed bytes despite an understated Content-Length", async () => {
  const f = fixture();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(40000));
      c.enqueue(new Uint8Array(40000));
      c.close();
    },
  });
  const init = {
    method: "POST",
    headers: { "Content-Length": "1" },
    body,
    duplex: "half" as const,
  };
  const response = await f.app.request(new Request("http://localhost/test-body", init));
  expect(response.status).toBe(413);
  expect(apiErrorResponseSchema.parse(await response.json()).error.code).toBe(
    "PAYLOAD_TOO_LARGE",
  );
  expect(f.calls()).toBe(0);
});
it("rejects oversized declared uploads and malformed lengths", async () => {
  const f = fixture();
  for (const [length, status] of [
    [String(HTTP_LIMITS.uploadBodyBytes + 1), 413],
    ["garbage", 400],
  ] as const) {
    const response = await f.app.request("/test-body", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=fixture",
        "Content-Length": length,
      },
      body: "tiny",
    });
    expect(response.status).toBe(status);
  }
  expect(f.calls()).toBe(0);
});
it("bounds actual multipart bodies including overhead", async () => {
  const f = fixture();
  for (const size of [HTTP_LIMITS.uploadBodyBytes, HTTP_LIMITS.uploadBodyBytes + 1]) {
    const response = await f.app.request("/test-body", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
      body: new Uint8Array(size),
    });
    expect(response.status).toBe(size === HTTP_LIMITS.uploadBodyBytes ? 200 : 413);
  }
});
