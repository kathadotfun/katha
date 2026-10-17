import Link from "next/link";
import type { PublicArtworkSummary } from "@katha/shared";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { explorationPhotoUrl } from "../lib/artwork-exploration";
import { ArtworkPhoto, PhotoPlaceholder } from "./artwork-photo";

// Catalogue results carry no price or availability; the card never implies either.
export function ArtworkCard({
  artwork,
  apiOrigin,
  heading = "h2",
  showArtist = true,
  large = false,
}: {
  artwork: PublicArtworkSummary;
  apiOrigin: string;
  heading?: "h2" | "h3";
  showArtist?: boolean;
  large?: boolean;
}) {
  const photo = explorationPhotoUrl(apiOrigin, artwork.heroImage);
  const Heading = heading;
  const href = `/art/${artwork.kathaId}`;
  return (
    <article className="card work min-w-0">
      <Link
        className="ph cut ratio-art"
        href={href}
        aria-label={`${artwork.title}, open artwork record`}
      >
        {photo && artwork.heroImage ? (
          <ArtworkPhoto src={photo} alt={artwork.heroImage.altText} />
        ) : (
          <PhotoPlaceholder label="Photo not available yet" size={large ? 64 : 56} />
        )}
      </Link>
      <div className="wb">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="chip-cat cut-s">
            {artworkCategoryLabels[artwork.category]}
          </span>
          <span className="sm mut">{artwork.creationYear}</span>
        </div>
        <Heading
          className="serif mt-1 mb-0 font-semibold"
          style={{ fontSize: large ? 21 : 18, lineHeight: large ? 1.15 : 1.18 }}
        >
          <Link href={href} className="text-madder no-underline hover:underline">
            {artwork.title}
          </Link>
        </Heading>
        {showArtist && (
          <p className="m-0 text-base text-ink">
            by{" "}
            <Link className="lnk" href={`/artists/${artwork.artist.slug}`}>
              {artwork.artist.displayName}
            </Link>
          </p>
        )}
        <p className="xs mut m-0">
          Katha ID <span className="id text-ink">{artwork.kathaId}</span>
        </p>
      </div>
    </article>
  );
}
