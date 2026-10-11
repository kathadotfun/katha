import type { Metadata } from "next";
import { PublicApiError } from "../../../lib/public-api";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArtworkDetail } from "../../../components/artwork-detail";
import {
  artworkCanonicalUrl,
  artworkCategoryLabels,
  loadPublicArtwork,
  loadPublicListing,
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
  searchParams: Promise<{
    historyOffset?: string | string[];
    source?: string | string[];
  }>;
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
  try {
    const artwork = await getArtwork((await params).kathaId);
    return {
      title: `${artwork.title} — ${artwork.artist.displayName} | Katha`,
      description: `${artworkCategoryLabels[artwork.category]} by ${artwork.artist.displayName}, ${artwork.creationYear}. A documented physical artwork on Katha.`,
      alternates: { canonical: artworkCanonicalUrl(artwork.kathaId) },
    };
  } catch (error) {
    if (error instanceof PublicApiError)
      return {
        title: "Artwork information unavailable | Katha",
        robots: { index: false, follow: true },
      };
    throw error;
  }
}

export default async function ArtworkPage({ params, searchParams }: ArtworkPageProps) {
  const artwork = await getArtwork((await params).kathaId);
  const query = await searchParams;
  const offset = historyOffset(query.historyOffset);
  const apiOrigin = serverApiOrigin();
  const [history, integrity, listing] = await Promise.all([
    offset === null
      ? Promise.resolve(null)
      : serverApi()
          .provenance(artwork.kathaId, { limit: "20", offset: String(offset) })
          .then((value) => validateArtworkHistory(artwork, value, offset))
          .catch(() => null),
    checkMetadataIntegrity(artwork, apiOrigin),
    loadPublicListing(artwork, (id) => serverApi().listing(id)),
  ]);
  return (
    <ArtworkDetail
      artwork={artwork}
      apiOrigin={apiOrigin}
      evidence={{ history, integrity }}
      listing={listing}
      // TODO(nfc): the API's /nfc/:tagId redirect does not yet append
      // `?source=nfc`, so this arrival note only appears on links that include it.
      arrivedByNfc={query.source === "nfc"}
    />
  );
}
