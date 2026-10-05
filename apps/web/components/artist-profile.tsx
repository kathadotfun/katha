import type { PublicArtistDetail } from "@katha/shared";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { explorationPageSize, explorationPhotoUrl } from "../lib/artwork-exploration";
import { artistWorksUrl, type ArtistWorks } from "../lib/artist-page";
import { ArtworkPhoto } from "./artwork-photo";
const dates = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "UTC",
});
export function ArtistProfile({
  artist,
  works,
  apiOrigin,
}: {
  artist: PublicArtistDetail;
  works: ArtistWorks;
  apiOrigin: string;
}) {
  return (
    <article
      className="page-container break-words py-[var(--section-space)]"
      aria-labelledby="artist-name"
    >
      <header className="grid items-start gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 max-w-reading">
          <p className="eyebrow text-brand">
            The artist · Nepali art &amp; Real World Assets
          </p>
          <h1 id="artist-name" className="mt-6 break-words text-display">
            {artist.displayName}
          </h1>
          <p className="mt-6 text-lead text-muted">{artist.region}</p>
          <section aria-labelledby="artist-traditions" className="mt-8">
            <h2 id="artist-traditions" className="text-xl">
              Art traditions
            </h2>
            <ul className="mt-3 space-y-2">
              {artist.traditions.map((tradition, index) => (
                <li key={index}>{tradition}</li>
              ))}
            </ul>
          </section>
          <p className="mt-8 text-sm text-muted">
            Artist profile manually verified by Katha on{" "}
            <time dateTime={artist.verifiedAt}>
              {dates.format(new Date(artist.verifiedAt))} UTC
            </time>
            . This records profile verification, not independent proof of every
            artwork&apos;s authenticity.
          </p>
        </div>
        <div className="min-w-0 max-w-sm">
          {artist.profileImageUrl ? (
            <ArtworkPhoto
              src={artist.profileImageUrl}
              alt={`Portrait of ${artist.displayName}`}
              caption="Artist portrait"
              primary
            />
          ) : (
            <p className="border-t border-line pt-6 text-muted">
              Artist portrait is not available yet.
            </p>
          )}
        </div>
      </header>
      <section
        aria-labelledby="artist-biography"
        className="mt-[var(--section-space)] max-w-reading"
      >
        <h2 id="artist-biography" className="text-section">
          The artist&apos;s story
        </h2>
        <p className="mt-6 whitespace-pre-wrap text-lead">{artist.biography}</p>
      </section>
      {artist.publicLinks.length > 0 && (
        <section aria-labelledby="artist-links" className="mt-10 max-w-reading">
          <h2 id="artist-links" className="text-xl">
            Public artist links
          </h2>
          <ul className="mt-4 space-y-3">
            {artist.publicLinks.map((href, index) => (
              <li key={index}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link break-all"
                >
                  {new URL(href).hostname}
                  <span className="sr-only">
                    {" "}
                    — artist link {index + 1}, opens in a new tab
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        id="artist-works"
        aria-labelledby="artist-artworks"
        className="mt-[var(--section-space)]"
      >
        <h2 id="artist-artworks" className="text-section">
          Artworks by {artist.displayName}
        </h2>
        <p className="mt-6 max-w-reading text-muted">
          Authorship remains with the artist when collectors change. Owning a work does
          not automatically transfer copyright or move the physical artwork.
        </p>
        {works.kind === "INVALID_QUERY" ? (
          <p className="mt-6">
            This artwork page number is unsupported.{" "}
            <a className="underline" href={artistWorksUrl(artist.slug, 0)}>
              Return to the first page
            </a>
            .
          </p>
        ) : works.kind === "UNAVAILABLE" ? (
          <div className="mt-6">
            <p role="alert">
              Published artworks are unavailable right now. The artist profile remains
              available.
            </p>
            <a
              className="text-link mt-4 inline-block"
              href={artistWorksUrl(artist.slug, works.offset)}
            >
              Try loading the artworks again
            </a>
          </div>
        ) : (
          <>
            <p className="mt-6 text-sm text-muted">
              Page {works.offset / explorationPageSize + 1} · {works.page.items.length}{" "}
              {works.page.items.length === 1 ? "work" : "works"} on this page
            </p>
            {works.page.items.length ? (
              <ul className="mt-8 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {works.page.items.map((artwork) => {
                  const src = explorationPhotoUrl(apiOrigin, artwork.heroImage);
                  return (
                    <li key={artwork.kathaId} className="min-w-0">
                      {src && artwork.heroImage ? (
                        <ArtworkPhoto
                          src={src}
                          alt={artwork.heroImage.altText}
                          caption={`${artworkCategoryLabels[artwork.category]} · ${artwork.creationYear}`}
                        />
                      ) : (
                        <div className="artwork-photo">
                          <p className="p-6 text-center text-muted">
                            Artwork photography is not available yet.
                          </p>
                        </div>
                      )}
                      <h3 className="mt-5 break-words text-2xl">
                        <a className="text-link" href={`/art/${artwork.kathaId}`}>
                          {artwork.title}
                        </a>
                      </h3>
                      <p className="mt-3 break-all font-mono text-xs text-muted">
                        {artwork.kathaId}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-8 text-muted">
                {works.offset
                  ? "No published artworks on this page. The catalogue may have changed."
                  : "No published artworks are available for this artist yet. This does not mean the artist has created no works."}
              </p>
            )}
            <nav
              aria-label="Artist artwork pages"
              className="mt-8 flex flex-wrap gap-8 border-t border-line pt-6"
            >
              {works.offset > 0 && (
                <a
                  className="text-link"
                  href={artistWorksUrl(artist.slug, works.offset - explorationPageSize)}
                >
                  Previous artworks
                </a>
              )}
              {works.page.pagination.hasMore &&
                works.offset + explorationPageSize <= 100000 && (
                  <a
                    className="text-link"
                    href={artistWorksUrl(
                      artist.slug,
                      works.offset + explorationPageSize,
                    )}
                  >
                    Next artworks
                  </a>
                )}
              {works.page.pagination.hasMore &&
                works.offset + explorationPageSize > 100000 && (
                  <p>More artworks exist beyond the public pagination limit.</p>
                )}
            </nav>
          </>
        )}
      </section>
    </article>
  );
}
