import {
  artistSlugSchema,
  publicArtistDetailSchema,
  artworkDiscoveryResponseSchema,
  type PublicArtistDetail,
} from "@katha/shared";
import { PublicApiError } from "./public-api.ts";
import { explorationPageSize } from "./artwork-exploration.ts";

export function artistCanonicalUrl(slug: string) {
  return `https://katha.fun/artists/${artistSlugSchema.parse(slug)}`;
}
export async function loadPublicArtist(
  slug: string,
  read: (slug: string) => Promise<unknown>,
): Promise<PublicArtistDetail | null> {
  const parsed = artistSlugSchema.safeParse(slug);
  if (!parsed.success) return null;
  try {
    const artist = publicArtistDetailSchema.parse(await read(parsed.data));
    if (artist.slug !== parsed.data) throw new PublicApiError("INVALID_RESPONSE");
    return artist;
  } catch (error) {
    if (error instanceof PublicApiError && error.kind === "NOT_FOUND") return null;
    throw error;
  }
}
export type ArtistWorks =
  | { kind: "INVALID_QUERY" }
  | { kind: "UNAVAILABLE"; offset: number }
  | {
      kind: "READY";
      offset: number;
      page: ReturnType<typeof artworkDiscoveryResponseSchema.parse>;
    };
export function artistWorksOffset(
  params: Readonly<Record<string, string | string[] | undefined>>,
): number | null {
  if (Object.keys(params).some((key) => key !== "offset")) return null;
  const value = params.offset ?? "0";
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,5})$/.test(value)) return null;
  const offset = Number(value);
  return offset <= 100000 && offset % explorationPageSize === 0 ? offset : null;
}
export function artistWorksUrl(slug: string, offset: number) {
  return `/artists/${artistSlugSchema.parse(slug)}${offset ? `?offset=${offset}` : ""}#artist-works`;
}
export async function loadArtistWorks(
  artist: PublicArtistDetail,
  params: Readonly<Record<string, string | string[] | undefined>>,
  read: (query: Readonly<Record<string, string>>) => Promise<unknown>,
): Promise<ArtistWorks> {
  const offset = artistWorksOffset(params);
  if (offset === null) return { kind: "INVALID_QUERY" };
  try {
    const page = artworkDiscoveryResponseSchema.parse(
      await read({
        artistId: artist.id,
        limit: String(explorationPageSize),
        offset: String(offset),
      }),
    );
    if (
      page.pagination.offset !== offset ||
      page.pagination.limit !== explorationPageSize ||
      page.items.some(
        (work) => work.artist.id !== artist.id || work.artist.slug !== artist.slug,
      ) ||
      new Set(page.items.map((work) => work.kathaId)).size !== page.items.length
    )
      throw new PublicApiError("INVALID_RESPONSE");
    return { kind: "READY", offset, page };
  } catch {
    return { kind: "UNAVAILABLE", offset };
  }
}
