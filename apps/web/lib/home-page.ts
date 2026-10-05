import {
  artworkDiscoveryResponseSchema,
  type PublicArtworkSummary,
} from "@katha/shared";

export const featuredArtworkLimit = 3;
export type FeaturedArtworks =
  { kind: "UNAVAILABLE" } | { kind: "READY"; items: PublicArtworkSummary[] };

export async function loadFeaturedArtworks(
  read: (query: Readonly<Record<string, string>>) => Promise<unknown>,
): Promise<FeaturedArtworks> {
  try {
    const page = artworkDiscoveryResponseSchema.parse(
      await read({ limit: String(featuredArtworkLimit), offset: "0" }),
    );
    if (
      page.pagination.limit !== featuredArtworkLimit ||
      page.pagination.offset !== 0 ||
      new Set(page.items.map((item) => item.kathaId)).size !== page.items.length ||
      page.items.some(
        (item, index) => index > 0 && page.items[index - 1]!.kathaId > item.kathaId,
      )
    )
      throw new Error("Featured response does not match the request");
    return { kind: "READY", items: page.items };
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}
