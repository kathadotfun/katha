import type { Metadata } from "next";
import { ArtworkExploration } from "../../components/artwork-exploration";
import {
  loadExploration,
  parseExplorationQuery,
  explorationUrl,
} from "../../lib/artwork-exploration";
import { serverApi, serverApiOrigin } from "../../lib/server-api";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = parseExplorationQuery(await searchParams);
  return {
    title: "Explore Nepali artworks | Katha",
    description:
      "Discover Mandala, Paubha and Thangka artworks as Real World Assets, with permanent artist attribution and documented cultural stories.",
    alternates: {
      canonical: `https://katha.fun${query ? explorationUrl(query) : "/explore"}`,
    },
    ...(!query ? { robots: { index: false, follow: true } } : {}),
  };
}
export default async function Explore({ searchParams }: Props) {
  const state = await loadExploration(await searchParams, (query) =>
    serverApi().artworks(query),
  );
  return <ArtworkExploration state={state} apiOrigin={serverApiOrigin()} />;
}
