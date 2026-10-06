import {
  artworkDraftCreateRequestSchema,
  artworkDraftUpdateRequestSchema,
  type ArtworkDraftResponse,
} from "@katha/shared";
export function parseArtworkDraftForm(
  form: FormData,
  creationRequestId: string,
  artwork?: ArtworkDraftResponse,
) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const integer = (name: string) =>
    /^\d+$/.test(text(name)) ? Number(text(name)) : NaN;
  const optional = (name: string) => text(name) || null;
  const input = {
    title: text("title"),
    materials: text("materials")
      ? text("materials")
          .split(/\r?\n/)
          .map((line) => line.trim())
      : [],
    dimensions: ["heightMm", "widthMm", "depthMm"].some((name) => text(name))
      ? {
          heightMm: integer("heightMm"),
          widthMm: integer("widthMm"),
          depthMm: text("depthMm") ? integer("depthMm") : null,
        }
      : null,
    origin: {
      countryCode: text("countryCode"),
      region: optional("region"),
      locality: optional("locality"),
    },
    technique: optional("technique"),
    story: optional("story"),
    meaning: optional("meaning"),
    culturalContext: optional("culturalContext"),
    creationProcess: optional("creationProcess"),
    authorshipEvidenceHash:
      artwork?.authorshipEvidenceHash ?? optional("authorshipEvidenceHash"),
  };
  const parsed = artwork
    ? artworkDraftUpdateRequestSchema.safeParse({
        ...input,
        expectedUpdatedAt: artwork.updatedAt,
      })
    : artworkDraftCreateRequestSchema.safeParse({
        ...input,
        creationRequestId: form.has("creationRequestId")
          ? text("creationRequestId")
          : creationRequestId,
        artistId: text("artistId"),
        category: text("category"),
        creationYear: integer("creationYear"),
      });
  const errors: Record<string, string> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const field =
        issue.path[0] === "dimensions"
          ? String(issue.path[1] ?? "heightMm")
          : issue.path[0] === "origin"
            ? String(issue.path[1] ?? "countryCode")
            : String(issue.path[0]);
      errors[field] ??= field.endsWith("Mm")
        ? "Enter a positive whole number in millimetres; height and width are required together."
        : `Check this field: ${issue.message}`;
    }
  return parsed.success ? { data: parsed.data, errors } : { data: null, errors };
}
