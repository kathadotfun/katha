import type { Metadata } from "next";
import { walletClusterSchema } from "@katha/shared";
import { Suspense } from "react";
import { KathaHomepage, FeaturedArtworksSection } from "../components/home-page";
import { loadFeaturedArtworks } from "../lib/home-page";
import { serverApi, serverApiOrigin } from "../lib/server-api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Katha — Tokenizing Nepali art as RWAs on Solana",
  description:
    "Bringing illiquid Nepali art onchain: Mandala, Paubha and Thangka paintings backed 1:1 by Solana assets, verified, inspected and tradeable like graded collectibles.",
  alternates: { canonical: "https://katha.fun/" },
};

async function FeaturedCatalogue() {
  const featured = await loadFeaturedArtworks((query) => serverApi().artworks(query));
  return <FeaturedArtworksSection featured={featured} apiOrigin={serverApiOrigin()} />;
}

export default function HomePage() {
  return (
    <KathaHomepage
      apiOrigin={serverApiOrigin()}
      cluster={walletClusterSchema.parse(process.env.KATHA_CLUSTER ?? "localnet")}
      featuredSection={
        <Suspense
          fallback={
            <section
              className="sec"
              aria-label="Loading published works"
              aria-busy="true"
            >
              <div className="wrap">
                <p role="status" className="p">
                  Loading published works…
                </p>
                <div className="grid-cards mt-6" aria-hidden="true">
                  {[1, 2, 3].map((key) => (
                    <div key={key} className="skel ratio-art" />
                  ))}
                </div>
              </div>
            </section>
          }
        >
          <FeaturedCatalogue />
        </Suspense>
      }
    />
  );
}
