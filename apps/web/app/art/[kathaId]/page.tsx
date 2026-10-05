import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArtworkDetail } from "../../../components/artwork-detail";
import {
  artworkCanonicalUrl,
  artworkCategoryLabels,
  loadPublicArtwork,
} from "../../../lib/artwork-page";
import {
  checkMetadataIntegrity,
  historyOffset,
  validateArtworkHistory,
} from "../../../lib/artwork-provenance";
import { serverApi, serverApiOrigin } from "../../../lib/server-api";

export const dynamic = "force-dynamic";

type ArtworkPageProps = {
  params: Promise<{ kathaId: string }>;
  searchParams: Promise<{ historyOffset?: string | string[] }>;
};

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

export default async function ArtworkPage({ params, searchParams }: ArtworkPageProps) {
  const artwork = await getArtwork((await params).kathaId);
  const offset = historyOffset((await searchParams).historyOffset);
  const apiOrigin = serverApiOrigin();
  const [history, integrity] = await Promise.all([
    offset === null
      ? Promise.resolve(null)
      : serverApi()
          .provenance(artwork.kathaId, { limit: "20", offset: String(offset) })
          .then((value) => validateArtworkHistory(artwork, value, offset))
          .catch(() => null),
    checkMetadataIntegrity(artwork, apiOrigin),
  ]);
  return (
    <ArtworkDetail
      artwork={artwork}
      apiOrigin={apiOrigin}
      evidence={{ history, integrity }}
    />
  );
}
