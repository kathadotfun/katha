import type { WalletSessionBoundary } from "./wallet-session.js";
import type { AuthorizationBoundary } from "./authorization.js";
import type { WalletSession } from "@katha/shared";
import { walletChallengeRequestSchema, walletVerifyRequestSchema } from "@katha/shared";
import { parseJson } from "./http.js";
import { restrictedCors, requestBodyLimit } from "./http.js";
import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { describeError, DomainError, type ApiErrorCode } from "./errors.js";
import type { Readiness } from "./readiness.js";
import { createLogger, type ApiLogger } from "./logger.js";

export type ApiEnvironment = {
  Variables: {
    requestId: string;
    errorCode: ApiErrorCode;
    walletSession: WalletSession;
  };
};

export function createApi(
  logger: ApiLogger = createLogger(),
  readiness?: Readiness,
  origins: readonly string[] = [],
  sessions?: WalletSessionBoundary,
  authorization?: AuthorizationBoundary,
) {
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
  if (sessions) {
    app.use("/auth/*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
  }
  for (const role of ["admin", "verifier"] as const) {
    app.use(`/${role}/*`, async (c, next) => {
      c.header("Cache-Control", "no-store");
      await next();
    });
  }
  app.use("*", restrictedCors(origins));
  app.use("*", requestBodyLimit());
  // Reserve both namespaces before any future write handlers are registered.
  for (const role of ["admin", "verifier"] as const) {
    app.use(`/${role}/*`, async (c, next) => {
      if (!authorization) {
        if (!sessions) throw new DomainError("UNAUTHENTICATED");
        await sessions.authenticate(c.req.header("Authorization"));
        throw new DomainError("FORBIDDEN");
      }
      c.set(
        "walletSession",
        await authorization.requireRole(c.req.header("Authorization"), role),
      );
      await next();
    });
  }
  app.get("/health/live", (context) => {
    context.header("Cache-Control", "no-store");
    return context.json({ status: "alive" });
  });
  app.get("/health/ready", async (context) => {
    context.header("Cache-Control", "no-store");
    const ready = readiness ? await readiness.check() : false;
    return context.json({ status: ready ? "ready" : "unavailable" }, ready ? 200 : 503);
  });
  if (sessions) {
    app.post("/auth/challenge", async (c) =>
      c.json(
        await sessions.challenge(await parseJson(c, walletChallengeRequestSchema)),
        201,
      ),
    );
    app.post("/auth/verify", async (c) =>
      c.json(await sessions.verify(await parseJson(c, walletVerifyRequestSchema))),
    );
    app.get("/auth/session", async (c) =>
      c.json(await sessions.authenticate(c.req.header("Authorization"))),
    );
    app.post("/auth/logout", async (c) => {
      await sessions.logout(c.req.header("Authorization"));
      return c.body(null, 204);
    });
  }
  app.onError(errorResponse);
  app.notFound((context) => errorResponse(new DomainError("NOT_FOUND"), context));
  return app;
}
