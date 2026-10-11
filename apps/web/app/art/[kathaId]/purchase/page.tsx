import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kathaIdSchema, type PublicArtworkDetail } from "@katha/shared";
import { serverApi, serverApiOrigin } from "../../../../lib/server-api";
import {
  artworkCategoryLabels,
  artworkPhotos,
  artworkPhotoUrl,
  loadPublicArtwork,
} from "../../../../lib/artwork-page";
import { PurchaseQuotePanel } from "../../../../components/purchase-quote";
import { ArtworkPhoto, PhotoPlaceholder } from "../../../../components/artwork-photo";
import { Icon } from "../../../../components/ui/status";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review purchase — Katha",
  robots: { index: false, follow: false },
};

function Summary({
  artwork,
  apiOrigin,
}: {
  artwork: PublicArtworkDetail;
  apiOrigin: string;
}) {
  const hero = artworkPhotos(artwork)[0];
  return (
    <>
      <div className="ph cut ratio-art">
        {hero ? (
          <ArtworkPhoto
            src={artworkPhotoUrl(apiOrigin, hero)}
            alt={hero.altText?.trim() || `Approved photo of ${artwork.title}`}
          />
        ) : (
          <PhotoPlaceholder label="Photo not available yet" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="xs mut">
          {artworkCategoryLabels[artwork.category]}, {artwork.creationYear}
        </span>
        <p className="serif m-0 text-2xl leading-[1.2] font-semibold text-madder wrap-anywhere">
          {artwork.title}
        </p>
        <p className="p sm">
          by{" "}
          <Link className="lnk" href={`/artists/${artwork.artist.slug}`}>
            {artwork.artist.displayName}
          </Link>
        </p>
        <p className="xs mut m-0">
          Katha ID <span className="id text-ink">{artwork.kathaId}</span>
        </p>
      </div>
    </>
  );
}

export default async function PurchasePage({
  params,
}: {
  params: Promise<{ kathaId: string }>;
}) {
  const id = kathaIdSchema.safeParse((await params).kathaId);
  if (!id.success) notFound();
  const apiOrigin = serverApiOrigin();
  // The summary is context only; the quote controller re-reads and validates the record.
  const artwork = await loadPublicArtwork(id.data, (value) =>
    serverApi().artwork(value),
  ).catch(() => null);
  return (
    <div className="app-main" style={{ paddingTop: "clamp(32px, 4vw, 56px)" }}>
      <div className="wrap">
        <Link className="lnk back-link" href={`/art/${id.data}`}>
          <Icon name="back" />
          Back to artwork record
        </Link>
        <h1 className="h1 mt-2">Review purchase</h1>
        <PurchaseQuotePanel
          kathaId={id.data}
          apiOrigin={apiOrigin}
          artistName={artwork?.artist.displayName ?? null}
          summary={artwork ? <Summary artwork={artwork} apiOrigin={apiOrigin} /> : null}
        />
      </div>
    </div>
  );
}
