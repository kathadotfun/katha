import { z } from "zod";

function validDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value === value.trim() &&
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      url.pathname.length > 1 &&
      !url.hash
    );
  } catch {
    return false;
  }
}
function validOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value === value.trim() &&
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      url.origin !== "null"
    );
  } catch {
    return false;
  }
}
const origin = z
  .string()
  .refine(validOrigin)
  .transform((value) => new URL(value).origin);
const serverConfigurationSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).default("127.0.0.1"),
  API_PORT: z
    .string()
    .regex(/^[1-9][0-9]{0,4}$/)
    .transform(Number)
    .pipe(z.number().int().max(65535))
    .default(3001),
  DATABASE_URL: z.string().refine(validDatabaseUrl),
  KATHA_CLUSTER: z.enum(["localnet", "devnet"]).default("localnet"),
  KATHA_PUBLIC_APP_ORIGIN: origin
    .refine((value) => {
      const host = new URL(value).host;
      return (
        host.length <= 253 &&
        /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/.test(host)
      );
    })
    .default("http://localhost:3000"),
  KATHA_PUBLIC_API_ORIGIN: origin.default("http://localhost:3001"),
});
export class ConfigurationError extends Error {
  constructor(
    readonly fields: readonly string[],
    message: string,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export type ServerConfiguration = Readonly<z.infer<typeof serverConfigurationSchema>>;

/** Only startup reads process.env; parsing never logs values or retains Zod errors. */
export function readServerConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfiguration {
  if (
    Object.keys(environment).some(
      (key) =>
        key.startsWith("NEXT_PUBLIC_") &&
        /DATABASE|PASSWORD|SECRET|TOKEN|PRIVATE_KEY/.test(key),
    )
  ) {
    throw new ConfigurationError(
      [],
      "Server-only settings must not use NEXT_PUBLIC_ aliases.",
    );
  }
  const parsed = serverConfigurationSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0]))),
    ].sort();
    throw new ConfigurationError(
      fields,
      `Invalid API configuration: ${fields.join(", ")}. Check the server environment.`,
    );
  }
  return Object.freeze(parsed.data);
}

/** Explicit allowlist: never spread environment/server settings into browser data. */
export function toPublicConfiguration(config: ServerConfiguration) {
  return Object.freeze({
    cluster: config.KATHA_CLUSTER,
    appOrigin: config.KATHA_PUBLIC_APP_ORIGIN,
    apiOrigin: config.KATHA_PUBLIC_API_ORIGIN,
  });
}
export type PublicConfiguration = ReturnType<typeof toPublicConfiguration>;
