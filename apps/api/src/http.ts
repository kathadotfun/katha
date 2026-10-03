import { HTTP_LIMITS } from "@katha/shared";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { z } from "zod";
import { DomainError } from "./errors.js";

const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const headers = ["content-type", "authorization"];

export function restrictedCors(origins: readonly string[]): MiddlewareHandler {
  const middleware = cors({
    origin: [...origins],
    allowMethods: methods,
    allowHeaders: headers,
    exposeHeaders: ["X-Request-Id"],
    credentials: true,
    maxAge: 600,
  });
  return async (context, next) => {
    const origin = context.req.header("Origin");
    if (origin === undefined) {
      context.header("Vary", "Origin", { append: true });
      return next();
    }
    // Reject before handlers run; CORS is still not authentication or CSRF protection.
    if (!origins.includes(origin)) {
      context.header("Vary", "Origin", { append: true });
      throw new DomainError("FORBIDDEN");
    }
    if (context.req.method === "OPTIONS") {
      context.header("Vary", "Access-Control-Request-Method", { append: true });
      const method = context.req.header("Access-Control-Request-Method");
      const requested = context.req.header("Access-Control-Request-Headers");
      if (
        !method ||
        !methods.includes(method) ||
        (requested &&
          requested
            .split(",")
            .some((header) => !headers.includes(header.trim().toLowerCase())))
      ) {
        context.header("Vary", "Origin, Access-Control-Request-Headers", {
          append: true,
        });
        throw new DomainError("FORBIDDEN");
      }
    }
    return middleware(context, next);
  };
}

export function requestBodyLimit(): MiddlewareHandler {
  return async (context, next) => {
    const raw = context.req.raw;
    const multipart =
      raw.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ===
      "multipart/form-data";
    const maximum = multipart ? HTTP_LIMITS.uploadBodyBytes : HTTP_LIMITS.jsonBodyBytes;
    const length = raw.headers.get("Content-Length");
    if (length !== null) {
      if (!/^(0|[1-9][0-9]*)$/.test(length)) throw new DomainError("INVALID_REQUEST");
      if (BigInt(length) > BigInt(maximum)) throw new DomainError("PAYLOAD_TOO_LARGE");
    }
    if (!raw.body) return next();
    const reader = raw.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          void reader.cancel().catch(() => {});
          throw new DomainError("PAYLOAD_TOO_LARGE");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("INVALID_REQUEST");
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    context.req.raw = new Request(raw, { body });
    await next();
  };
}

export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError("INVALID_REQUEST");
  return parsed.data;
}

export function parseQuery<T extends z.ZodType>(
  context: Context,
  schema: T,
): z.output<T> {
  const query: Record<string, string> = Object.create(null);
  for (const [key, values] of Object.entries(context.req.queries())) {
    if (values.length !== 1) throw new DomainError("INVALID_REQUEST");
    query[key] = values[0]!;
  }
  return parseInput(schema, query);
}

export function parseParams<T extends z.ZodType>(
  context: Context,
  schema: T,
): z.output<T> {
  return parseInput(schema, context.req.param());
}

export async function parseJson<T extends z.ZodType>(
  context: Context,
  schema: T,
): Promise<z.output<T>> {
  if (
    context.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    throw new DomainError("UNSUPPORTED_MEDIA_TYPE");
  let input: unknown;
  try {
    input = await context.req.json();
  } catch {
    throw new DomainError("INVALID_REQUEST");
  }
  return parseInput(schema, input);
}
