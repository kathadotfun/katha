import type { PublicArtworkDetail } from "@katha/shared";
import {
  artworkCategoryLabels,
  artworkDimensionsLabel,
  artworkOriginLabel,
  artworkPhotoLabel,
  artworkPhotos,
  artworkPhotoUrl,
} from "../lib/artwork-page";
import type { ArtworkEvidence } from "../lib/artwork-provenance";
import { ArtworkProvenance } from "./artwork-provenance";
import { ArtworkCare } from "./artwork-care";
import { ArtworkPhoto } from "./artwork-photo";

function Documentation({
  id,
  title,
  text,
}: {
  id: string;
  title: string;
  text: string | null;
}) {
  return (
    <section aria-labelledby={id} className="artwork-documentation">
      <h2 id={id} className="text-section">
        {title}
      </h2>
      <p className="mt-6 whitespace-pre-wrap text-lead">
        {text ?? "Not yet documented."}
      </p>
    </section>
  );
}

export function ArtworkDetail({
  artwork,
  apiOrigin,
  evidence,
}: {
  artwork: PublicArtworkDetail;
  apiOrigin: string;
  evidence?: ArtworkEvidence;
}) {
  const photos = artworkPhotos(artwork);
  const hero = photos[0];
  function photo(media: PublicArtworkDetail["media"][number], primary = false) {
    const label = artworkPhotoLabel(media.role);
    return (
      <ArtworkPhoto
        key={`${media.id}:${media.contentHash}`}
        src={artworkPhotoUrl(apiOrigin, media)}
        alt={media.altText?.trim() || `${artwork.title} — ${label.toLowerCase()}`}
        caption={label}
        primary={primary}
      />
    );
  }
  return (
    <article className="page-container artwork-page" aria-labelledby="artwork-title">
      <header className="artwork-introduction">
        <p className="eyebrow text-brand">
          {artworkCategoryLabels[artwork.category]} · Real World Assets
        </p>
        <h1 id="artwork-title" className="mt-6 break-words text-display">
          {artwork.title}
        </h1>
        <p className="mt-6 text-lead">
          Created by{" "}
          <a className="text-link font-medium" href={`/artists/${artwork.artist.slug}`}>
            {artwork.artist.displayName}
          </a>{" "}
          · {artwork.creationYear}
        </p>
        <p className="mt-3 break-all font-mono text-sm text-muted">{artwork.kathaId}</p>
      </header>
      <div className="artwork-overview">
        {hero ? (
          photo(hero, true)
        ) : (
          <div className="artwork-photo artwork-photo-primary">
            <p className="p-6 text-center text-muted">
              Artwork photography is not available yet.
            </p>
          </div>
        )}
        <section aria-labelledby="artwork-details" className="min-w-0">
          <h2 id="artwork-details" className="text-section">
            About the work
          </h2>
          <dl className="artwork-facts mt-8">
            <div>
              <dt>Art form</dt>
              <dd>{artworkCategoryLabels[artwork.category]}</dd>
            </div>
            <div>
              <dt>Origin</dt>
              <dd>{artworkOriginLabel(artwork.origin)}</dd>
            </div>
            <div>
              <dt>Dimensions</dt>
              <dd>{artworkDimensionsLabel(artwork.dimensions)}</dd>
            </div>
            <div>
              <dt>Materials</dt>
              <dd>
                {artwork.materials.length ? (
                  <ul>
                    {artwork.materials.map((material, index) => (
                      <li key={index}>{material}</li>
                    ))}
                  </ul>
                ) : (
                  "Not documented"
                )}
              </dd>
            </div>
            <div>
              <dt>Technique</dt>
              <dd>{artwork.technique ?? "Not documented"}</dd>
            </div>
          </dl>
          <p className="mt-8 text-sm text-muted">
            Artist authorship is preserved when ownership changes. Collecting a work
            does not automatically transfer copyright or reproduction rights.
          </p>
        </section>
      </div>
      <div className="artwork-reading">
        <Documentation id="artwork-story" title="The story" text={artwork.story} />
        <Documentation id="artwork-meaning" title="Meaning" text={artwork.meaning} />
        <Documentation
          id="artwork-culture"
          title="Cultural context"
          text={artwork.culturalContext}
        />
        <Documentation
          id="artwork-process"
          title="How it was made"
          text={artwork.creationProcess}
        />
      </div>
      <ArtworkCare artwork={artwork} />
      <ArtworkProvenance artwork={artwork} evidence={evidence} />
      {photos.length > 1 && (
        <section
          aria-labelledby="artwork-photographs"
          className="artwork-gallery-section"
        >
          <h2 id="artwork-photographs" className="text-section">
            A closer look
          </h2>
          <div className="artwork-gallery mt-8">
            {photos.slice(1).map((media) => photo(media))}
          </div>
        </section>
      )}
    </article>
  );
}
