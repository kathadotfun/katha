import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { describeError, DomainError, type ApiErrorCode } from "./errors.js";
import type { Readiness } from "./readiness.js";
import { createLogger, type ApiLogger } from "./logger.js";

type ApiEnvironment = { Variables: { requestId: string; errorCode: ApiErrorCode } };

export function createApi(logger: ApiLogger = createLogger(), readiness?: Readiness) {
  const app = new Hono<ApiEnvironment>();
  function errorResponse(error: unknown, context: Context<ApiEnvironment>) {
    const { code, message, status } = describeError(error);
    context.set("errorCode", code);
    return context.json(
      { error: { code, message }, requestId: context.get("requestId") },
      status,
    );
  }
  app.use("*", async (context, next) => {
    // Client-supplied IDs are untrusted; each request receives a fresh server ID.
    const requestId = randomUUID();
    context.set("requestId", requestId);
    const start = performance.now();
    try {
      await next();
    } catch (error) {
      // Hono's onError handles Error instances; normalize other thrown values too.
      context.res = errorResponse(error, context);
    }
    context.header("X-Request-Id", requestId);
    const code = context.get("errorCode");
    logger.requestCompleted({
      requestId,
      method: context.req.method,
      status: context.res.status,
      durationMs: performance.now() - start,
      ...(code ? { code } : {}),
    });
  });
  app.get("/health/live", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ status: "alive" });
  });
  app.get("/health/ready", async (context) => {
    context.header("Cache-Control", "no-store");
    const ready = readiness ? await readiness.check() : false;
    return context.json({ status: ready ? "ready" : "unavailable" }, ready ? 200 : 503);
  });
  app.onError(errorResponse);
  app.notFound((context) => errorResponse(new DomainError("NOT_FOUND"), context));
  return app;
}
