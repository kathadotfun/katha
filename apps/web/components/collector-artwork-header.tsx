import Link from "next/link";
import type { PublicArtworkDetail } from "@katha/shared";
import { artworkPhotos, artworkPhotoUrl } from "../lib/artwork-page";
import { ArtworkPhoto, PhotoPlaceholder } from "./artwork-photo";
import { Icon } from "./ui/status";

// Public context for a private collector page; ownership is checked by the panel.
export function CollectorArtworkHeader({
  title,
  kathaId,
  artwork,
  apiOrigin,
}: {
  title: string;
  kathaId: string;
  artwork: PublicArtworkDetail | null;
  apiOrigin: string;
}) {
  const hero = artwork ? artworkPhotos(artwork)[0] : undefined;
  return (
    <>
      <Link className="lnk back-link" href="/collection">
        <Icon name="back" />
        Back to my collection
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-7 gap-y-5">
        <div className="ph ph-sm cut-s ratio-art w-21 flex-none" aria-hidden="true">
          {hero ? (
            <ArtworkPhoto
              src={artworkPhotoUrl(apiOrigin, hero)}
              alt=""
              fallbackSize={32}
            />
          ) : (
            <PhotoPlaceholder size={32} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1" style={{ flex: "1 1 300px" }}>
          <h1 className="h1">{title}</h1>
          <p className="p">
            {artwork ? (
              <>
                <Link className="lnk" href={`/art/${kathaId}`}>
                  {artwork.title}
                </Link>{" "}
                by {artwork.artist.displayName},{" "}
              </>
            ) : null}
            <span className="id">{kathaId}</span>
          </p>
        </div>
      </div>
    </>
  );
}
