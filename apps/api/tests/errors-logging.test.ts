import { createApi } from "../src/app.js";
import { DomainError } from "../src/errors.js";
import { createLogger } from "../src/logger.js";
import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { expect, it } from "vitest";
import { apiErrorResponseSchema } from "@katha/shared";

function fixture() {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line));
  return { app: createApi(logger), logger, lines };
}
const privateValue = "SYNTHETIC_PRIVATE_EVIDENCE";

it.each([
  ["INVALID_REQUEST", 400],
  ["UNAUTHENTICATED", 401],
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["CONFLICT", 409],
] as const)("maps %s to a fixed response and correlated log", async (code, status) => {
  const { app, lines } = fixture();
  app.get("/failure", () => {
    const error = new DomainError(code);
    error.message = privateValue;
    error.stack = privateValue;
    throw error;
  });
  const response = await app.request("/failure");
  const body = apiErrorResponseSchema.parse(await response.json());
  expect(response.status).toBe(status);
  expect(body).toEqual({
    error: { code, message: expect.any(String) },
    requestId: response.headers.get("X-Request-Id"),
  });
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "request_completed",
    code,
    status,
    requestId: body.requestId,
  });
  expect(JSON.stringify(body) + lines.join("")).not.toContain(privateValue);
});

it.each([
  new Error(privateValue),
  new HTTPException(403, { message: privateValue }),
  privateValue,
])("masks unexpected failures, including framework exceptions", async (error) => {
  const { app, lines } = fixture();
  app.get("/failure", () => {
    throw error;
  });
  const response = await app.request("/failure");
  const body = apiErrorResponseSchema.parse(await response.json());
  expect(response.status).toBe(500);
  expect(body.error).toEqual({
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    level: "error",
    code: "INTERNAL_ERROR",
    requestId: body.requestId,
  });
  expect(JSON.stringify(body) + lines.join("")).not.toContain(privateValue);
});

it("omits private path, query, body, headers and session data", async () => {
  const { app, lines } = fixture();
  app.post("/evidence/:id", async (context) => {
    await context.req.text();
    return context.json({ ok: true });
  });
  const response = await app.request(
    `/evidence/${privateValue}?token=${privateValue}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateValue}`,
        Cookie: `session=${privateValue}`,
        "X-Request-Id": privateValue,
      },
      body: privateValue,
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(lines).toHaveLength(1);
  const log = JSON.parse(lines[0]!);
  expect(Object.keys(log).sort()).toEqual([
    "durationMs",
    "event",
    "level",
    "method",
    "requestId",
    "status",
    "timestamp",
  ]);
  expect(log.durationMs).toBeGreaterThanOrEqual(0);
  expect(lines.join("")).not.toContain(privateValue);
});

it("returns a correlated JSON 404 without reflecting unknown paths", async () => {
  const { app, lines } = fixture();
  const response = await app.request(`/${privateValue}`);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    error: { code: "NOT_FOUND" },
    requestId: response.headers.get("X-Request-Id"),
  });
  expect(lines.join("")).not.toContain(privateValue);
});

it("isolates concurrent requests and replaces even well-formed client IDs", async () => {
  const { app, lines } = fixture();
  const incoming = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      app.request("/missing", { headers: { "X-Request-Id": incoming } }),
    ),
  );
  const ids = responses.map((response) => response.headers.get("X-Request-Id"));
  expect(new Set(ids).size).toBe(20);
  expect(ids).not.toContain(incoming);
  expect(new Set(lines.map((line) => JSON.parse(line).requestId))).toEqual(
    new Set(ids),
  );
});

it("allows only bounded public transaction identifiers and ignores extra properties", () => {
  const { logger, lines } = fixture();
  const input = {
    requestId: randomUUID(),
    cluster: "devnet" as const,
    signature: "1".repeat(64),
    password: privateValue,
  };
  logger.transactionObserved(input);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "transaction_observed",
    requestId: input.requestId,
    signature: input.signature,
  });
  for (const signature of [privateValue, "1".repeat(89), "0".repeat(64)])
    logger.transactionObserved({ ...input, signature });
  logger.transactionObserved({ ...input, requestId: privateValue });
  expect(lines).toHaveLength(1);
  expect(lines.join("")).not.toContain(privateValue);
});

it("selects configuration names and request fields without spreading caller data", () => {
  const { logger, lines } = fixture();
  logger.configurationInvalid(["DATABASE_URL", privateValue, "DATABASE_URL"]);
  logger.requestCompleted({
    requestId: privateValue,
    method: privateValue,
    status: 200,
    durationMs: Infinity,
    password: privateValue,
  } as Parameters<typeof logger.requestCompleted>[0]);
  expect(JSON.parse(lines[0]!)).toMatchObject({ fields: ["DATABASE_URL"] });
  expect(JSON.parse(lines[1]!)).toMatchObject({ method: "OTHER", durationMs: 0 });
  expect(lines.join("")).not.toContain(privateValue);
});

it("keeps logger transport failures from changing HTTP outcomes", async () => {
  const app = createApi(
    createLogger(() => {
      throw new Error(privateValue);
    }),
  );
  expect((await app.request("/missing")).status).toBe(404);
});
