import {
  kathaIdSchema,
  type ArtworkCategory,
  type PublicArtworkDetail,
} from "@katha/shared";
import { PublicApiError, publicApiOrigin } from "./public-api.ts";

export const artworkCategoryLabels: Readonly<Record<ArtworkCategory, string>> = {
  MANDALA: "Mandala",
  PAUBHA: "Paubha",
  THANGKA: "Thangka",
};

export async function loadPublicArtwork(
  id: string,
  read: (id: string) => Promise<PublicArtworkDetail>,
): Promise<PublicArtworkDetail | null> {
  const parsed = kathaIdSchema.safeParse(id);
  if (!parsed.success) return null;
  try {
    const artwork = await read(parsed.data);
    // A valid response for another work must never appear under this permanent URL.
    if (artwork.kathaId !== parsed.data) throw new PublicApiError("INVALID_RESPONSE");
    return artwork;
  } catch (error) {
    if (error instanceof PublicApiError && error.kind === "NOT_FOUND") return null;
    throw error;
  }
}

export function artworkCanonicalUrl(id: string): string {
  return `https://katha.fun/art/${kathaIdSchema.parse(id)}`;
}

const imageExtensions: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

const photoLabels: Readonly<Record<string, string>> = {
  HERO: "Artwork photograph",
  FRONT: "Front view",
  BACK: "Back view",
  DETAIL: "Detail view",
  ARTIST: "Artist with artwork",
  PROCESS: "Creation process",
  DOCUMENTARY: "Documentary photograph",
  OTHER: "Artwork photograph",
};

export function artworkPhotos(artwork: PublicArtworkDetail) {
  const photos = artwork.media
    .filter(
      (media) =>
        media.kind === "IMAGE" &&
        Object.hasOwn(imageExtensions, media.mimeType) &&
        Object.hasOwn(photoLabels, media.role),
    )
    .toSorted((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const hero =
    photos.find((photo) => photo.role === "HERO") ??
    photos.find((photo) => photo.role === "FRONT") ??
    photos[0];
  return hero ? [hero, ...photos.filter((photo) => photo !== hero)] : [];
}

export function artworkPhotoLabel(role: string): string {
  return Object.hasOwn(photoLabels, role) ? photoLabels[role]! : "Artwork photograph";
}

export function artworkPhotoUrl(
  origin: string,
  media: PublicArtworkDetail["media"][number],
): string {
  const extension = Object.hasOwn(imageExtensions, media.mimeType)
    ? imageExtensions[media.mimeType]
    : undefined;
  if (
    media.kind !== "IMAGE" ||
    !extension ||
    !/^[0-9a-f]{64}$/.test(media.contentHash)
  ) {
    throw new PublicApiError("INVALID_RESPONSE");
  }
  return `${publicApiOrigin(origin)}/storage/public/${media.contentHash}.${extension}`;
}

export function artworkDimensionsLabel(
  dimensions: PublicArtworkDetail["dimensions"],
): string {
  if (!dimensions) return "Not documented";
  const depth = dimensions.depthMm ? ` × ${dimensions.depthMm}` : "";
  return `${dimensions.heightMm} × ${dimensions.widthMm}${depth} mm (height × width${depth ? " × depth" : ""})`;
}

export function artworkOriginLabel(origin: PublicArtworkDetail["origin"]): string {
  if (!origin) return "Not documented";
  // Preserve recorded places; an absent locality is not evidence of a specific city.
  return [
    origin.locality,
    origin.region,
    origin.countryCode === "NP" ? "Nepal" : origin.countryCode,
  ]
    .filter((part) => part && part.trim())
    .join(", ");
}
