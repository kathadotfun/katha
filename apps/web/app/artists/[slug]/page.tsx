import type { Metadata } from "next";
import { PublicApiError } from "../../../lib/public-api";
import { cache } from "react";
import { notFound } from "next/navigation";
import { ArtistProfile } from "../../../components/artist-profile";
import {
  artistCanonicalUrl,
  artistWorksOffset,
  loadArtistWorks,
  loadPublicArtist,
} from "../../../lib/artist-page";
import { serverApi, serverApiOrigin } from "../../../lib/server-api";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const getArtist = cache(async (slug: string) => {
  const artist = await loadPublicArtist(slug, (value) => serverApi().artist(value));
  if (!artist) notFound();
  return artist;
});
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  try {
    const artist = await getArtist((await params).slug);
    return {
      title: `${artist.displayName} — Artist | Katha`,
      description: `Discover ${artist.displayName}, an artist from ${artist.region}, and their documented cultural artworks on Katha.`,
      alternates: { canonical: artistCanonicalUrl(artist.slug) },
      ...(artistWorksOffset(await searchParams) === null
        ? { robots: { index: false, follow: true } }
        : {}),
    };
  } catch (error) {
    if (error instanceof PublicApiError)
      return {
        title: "Artist information unavailable | Katha",
        robots: { index: false, follow: true },
      };
    throw error;
  }
}

export default async function ArtistPage({ params, searchParams }: Props) {
  const artist = await getArtist((await params).slug);
  const works = await loadArtistWorks(artist, await searchParams, (query) =>
    serverApi().artworks(query),
  );
  return <ArtistProfile artist={artist} works={works} apiOrigin={serverApiOrigin()} />;
}
