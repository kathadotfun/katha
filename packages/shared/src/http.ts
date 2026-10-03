import { z } from "zod";

export const apiErrors = {
  INVALID_REQUEST: { status: 400, message: "The request is invalid." },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue." },
  FORBIDDEN: { status: 403, message: "This action is not permitted." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "The request conflicts with the current state." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request body is too large." },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: "The request content type is not supported.",
  },
  INTERNAL_ERROR: { status: 500, message: "An unexpected error occurred." },
} as const;
export const apiErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export const apiErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: apiErrorCodeSchema, message: z.string().max(200) }),
  requestId: z.uuidv4(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const HTTP_LIMITS = Object.freeze({
  jsonBodyBytes: 64 * 1024,
  uploadBodyBytes: 10 * 1024 * 1024,
  pageSize: 100,
  offset: 100_000,
});
const limitQuery = z
  .string()
  .regex(/^[1-9][0-9]{0,2}$/)
  .transform(Number)
  .pipe(z.number().int().max(HTTP_LIMITS.pageSize));
const offsetQuery = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,5})$/)
  .transform(Number)
  .pipe(z.number().int().max(HTTP_LIMITS.offset));
export const paginationQuerySchema = z.strictObject({
  limit: limitQuery.optional().transform((value) => value ?? 20),
  offset: offsetQuery.optional().transform((value) => value ?? 0),
});
export type Pagination = z.infer<typeof paginationQuerySchema>;
export const paginationResponseSchema = z.strictObject({
  limit: z.number().int().min(1).max(HTTP_LIMITS.pageSize),
  offset: z.number().int().min(0).max(HTTP_LIMITS.offset),
  hasMore: z.boolean(),
});
export function paginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z
    .strictObject({
      items: z.array(item).max(HTTP_LIMITS.pageSize),
      pagination: paginationResponseSchema,
    })
    .refine(({ items, pagination }) => items.length <= pagination.limit, {
      error: "Page exceeds requested limit",
    });
}
