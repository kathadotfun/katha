import {
  artworkDiscoveryQuerySchema,
  artworkDiscoveryResponseSchema,
  type ArtworkDiscoveryQuery,
  type PublicArtworkSummary,
} from "@katha/shared";
import { artworkPhotoUrl } from "./artwork-page.ts";

export const explorationPageSize = 12;
export type ExplorationQuery = Pick<ArtworkDiscoveryQuery, "category" | "offset">;
export type ExplorationState =
  | { kind: "INVALID_QUERY" }
  | { kind: "UNAVAILABLE"; query: ExplorationQuery }
  | {
      kind: "READY";
      query: ExplorationQuery;
      page: ReturnType<typeof artworkDiscoveryResponseSchema.parse>;
    };

export function parseExplorationQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): ExplorationQuery | null {
  if (Object.keys(params).some((key) => key !== "category" && key !== "offset"))
    return null;
  const parsed = artworkDiscoveryQuerySchema.safeParse({
    ...params,
    limit: String(explorationPageSize),
  });
  if (!parsed.success || parsed.data.offset % explorationPageSize !== 0) return null;
  return {
    offset: parsed.data.offset,
    ...(parsed.data.category ? { category: parsed.data.category } : {}),
  };
}

export function explorationUrl(query: ExplorationQuery): string {
  const params = new URLSearchParams();
  if (query.category) params.set("category", query.category);
  if (query.offset) params.set("offset", String(query.offset));
  const suffix = params.toString();
  return `/explore${suffix ? `?${suffix}` : ""}`;
}

export function explorationPhotoUrl(
  origin: string,
  hero: PublicArtworkSummary["heroImage"],
): string | null {
  if (!hero) return null;
  try {
    return artworkPhotoUrl(origin, { ...hero, kind: "IMAGE" });
  } catch {
    return null;
  }
}

export async function loadExploration(
  params: Readonly<Record<string, string | string[] | undefined>>,
  read: (query: Readonly<Record<string, string>>) => Promise<unknown>,
): Promise<ExplorationState> {
  const query = parseExplorationQuery(params);
  if (!query) return { kind: "INVALID_QUERY" };
  try {
    const page = artworkDiscoveryResponseSchema.parse(
      await read({
        limit: String(explorationPageSize),
        offset: String(query.offset),
        ...(query.category ? { category: query.category } : {}),
      }),
    );
    if (
      page.pagination.limit !== explorationPageSize ||
      page.pagination.offset !== query.offset ||
      (query.category && page.items.some((item) => item.category !== query.category)) ||
      new Set(page.items.map((item) => item.kathaId)).size !== page.items.length
    )
      throw new Error("Discovery response does not match the request");
    return { kind: "READY", query, page };
  } catch {
    return { kind: "UNAVAILABLE", query };
  }
}
