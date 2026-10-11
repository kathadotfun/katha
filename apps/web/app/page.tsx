import type { Metadata } from "next";
import { walletClusterSchema } from "@katha/shared";
import { KathaHomepage } from "../components/home-page";
import { loadFeaturedArtworks } from "../lib/home-page";
import { serverApi, serverApiOrigin } from "../lib/server-api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Katha — Nepal's cultural art as RWAs on Solana",
  description:
    "Preserving Nepali culture on chain: Mandala, Paubha and Thangka paintings linked to permanent records of their artists, owners and history.",
  alternates: { canonical: "https://katha.fun/" },
};

export default async function HomePage() {
  const featured = await loadFeaturedArtworks((query) => serverApi().artworks(query));
  return (
    <KathaHomepage
      featured={featured}
      apiOrigin={serverApiOrigin()}
      cluster={walletClusterSchema.parse(process.env.KATHA_CLUSTER ?? "localnet")}
    />
  );
}
