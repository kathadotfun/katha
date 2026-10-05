import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArtworkDetail } from "../../../components/artwork-detail";
import {
  artworkCanonicalUrl,
  artworkCategoryLabels,
  loadPublicArtwork,
} from "../../../lib/artwork-page";
import { serverApi, serverApiOrigin } from "../../../lib/server-api";

export const dynamic = "force-dynamic";

type ArtworkPageProps = { params: Promise<{ kathaId: string }> };

const getArtwork = cache(async (id: string) => {
  const artwork = await loadPublicArtwork(id, (validId) =>
    serverApi().artwork(validId),
  );
  if (!artwork) notFound();
  return artwork;
});

export async function generateMetadata({
  params,
}: ArtworkPageProps): Promise<Metadata> {
  const artwork = await getArtwork((await params).kathaId);
  return {
    title: `${artwork.title} — ${artwork.artist.displayName} | Katha`,
    description: `${artworkCategoryLabels[artwork.category]} by ${artwork.artist.displayName}, ${artwork.creationYear}. A documented physical artwork on Katha.`,
    alternates: { canonical: artworkCanonicalUrl(artwork.kathaId) },
  };
}

export default async function ArtworkPage({ params }: ArtworkPageProps) {
  const artwork = await getArtwork((await params).kathaId);
  return <ArtworkDetail artwork={artwork} apiOrigin={serverApiOrigin()} />;
}
