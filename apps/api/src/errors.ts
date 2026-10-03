import { apiErrors, type ApiErrorCode } from "@katha/shared";
export type { ApiErrorCode } from "@katha/shared";
export type DomainErrorCode = Exclude<ApiErrorCode, "INTERNAL_ERROR">;

/** Callers select a code, never a message containing private input. */
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode) {
    super(apiErrors[code].message);
    this.name = "DomainError";
  }
}
export function describeError(error: unknown) {
  if (error instanceof DomainError && Object.hasOwn(apiErrors, error.code)) {
    return { code: error.code, ...apiErrors[error.code] };
  }
  return { code: "INTERNAL_ERROR", ...apiErrors.INTERNAL_ERROR } as const;
}
