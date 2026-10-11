// Only same-site Katha paths may be offered after sign-in; anything that could
// leave the origin (`//host`, `/\host`, schemes) or carry control characters is dropped.
const allowed = /^\/(?:art|collection|admin)(?:\/[A-Za-z0-9._~-]+)*\/?$/;

export function safeReturnPath(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  return allowed.test(value) ? value : null;
}

export function signInHref(path: string): string {
  return safeReturnPath(path)
    ? `/account?next=${encodeURIComponent(path)}`
    : "/account";
}
