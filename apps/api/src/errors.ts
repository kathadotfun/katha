const domainErrors = {
  INVALID_REQUEST: { status: 400, message: "The request is invalid." },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue." },
  FORBIDDEN: { status: 403, message: "This action is not permitted." },
  NOT_FOUND: { status: 404, message: "The requested resource was not found." },
  CONFLICT: { status: 409, message: "The request conflicts with the current state." },
} as const;

export type DomainErrorCode = keyof typeof domainErrors;
export type ApiErrorCode = DomainErrorCode | "INTERNAL_ERROR";

/** Callers select a code, never a message containing private input. */
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode) {
    super(domainErrors[code].message);
    this.name = "DomainError";
  }
}

export function describeError(error: unknown) {
  if (error instanceof DomainError && Object.hasOwn(domainErrors, error.code)) {
    return { code: error.code, ...domainErrors[error.code] };
  }
  return {
    code: "INTERNAL_ERROR",
    status: 500,
    message: "An unexpected error occurred.",
  } as const;
}
