import { address } from "@solana/kit";
import { artistCreateRequestSchema } from "@katha/shared";

export function parseArtistForm(data: FormData) {
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const lines = (name: string) =>
    text(name)
      ? text(name)
          .split(/\r?\n/)
          .map((line) => line.trim())
      : [];
  const input = {
    displayName: text("displayName"),
    slug: text("slug"),
    biography: text("biography"),
    region: text("region"),
    traditions: lines("traditions"),
    publicLinks: lines("publicLinks"),
    profileImageUrl: text("profileImageUrl") || null,
    creatorWallet: text("creatorWallet") || null,
    payoutWallet: text("payoutWallet") || null,
  };
  const errors: Record<string, string> = {};
  const parsed = artistCreateRequestSchema.safeParse(input);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]);
      errors[name] ??=
        name === "slug"
          ? "Use lowercase letters and digits separated by single hyphens."
          : name.endsWith("Wallet")
            ? "Enter a nonzero Solana public address or leave blank."
            : name === "publicLinks" || name === "profileImageUrl"
              ? "Use approved HTTP(S) URLs without credentials or whitespace."
              : `Check ${name}: ${issue.message}`;
    }
  for (const name of ["creatorWallet", "payoutWallet"] as const)
    if (input[name]) {
      try {
        address(input[name]);
        if (input[name] === "11111111111111111111111111111111")
          throw new Error("Zero wallet");
      } catch {
        errors[name] = "Enter a nonzero Solana public address or leave blank.";
      }
    }
  return parsed.success && !Object.keys(errors).length
    ? { data: parsed.data, errors }
    : { data: null, errors };
}
