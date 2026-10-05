import type { Metadata } from "next";
import { KathaHomepage } from "../components/home-page";
import { loadFeaturedArtworks } from "../lib/home-page";
import { serverApi, serverApiOrigin } from "../lib/server-api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Katha — Real World Assets, rooted in Nepali culture",
  description:
    "Discover documented Nepali artworks, their artists and cultural stories, with permanent attribution and verifiable provenance on Solana Devnet.",
  alternates: { canonical: "https://katha.fun/" },
};

export default async function HomePage() {
  const featured = await loadFeaturedArtworks((query) => serverApi().artworks(query));
  return <KathaHomepage featured={featured} apiOrigin={serverApiOrigin()} />;
}
