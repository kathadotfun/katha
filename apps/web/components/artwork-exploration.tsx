import { artworkCategoryLabels } from "../lib/artwork-page";
import {
  explorationPageSize,
  explorationPhotoUrl,
  explorationUrl,
  type ExplorationState,
  type ExplorationQuery,
} from "../lib/artwork-exploration";
import { ArtworkPhoto } from "./artwork-photo";

export function ArtworkExploration({
  state,
  apiOrigin,
}: {
  state: ExplorationState;
  apiOrigin: string;
}) {
  const query: ExplorationQuery =
    state.kind === "INVALID_QUERY" ? { offset: 0 } : state.query;
  return (
    <section
      className="page-container py-[var(--section-space)]"
      aria-labelledby="explore-title"
    >
      <header className="max-w-reading">
        <p className="eyebrow text-brand">Nepali art · Real World Assets</p>
        <h1 id="explore-title" className="mt-6 text-display">
          Explore the artworks
        </h1>
        <p className="mt-6 text-lead text-muted">
          Discover documented Mandala, Paubha and Thangka works, the artists behind
          them, and the stories they preserve.
        </p>
        <p className="mt-4 text-sm text-muted">
          Publication records Katha&apos;s manual verification. It does not establish a
          live condition assessment or availability for sale.
        </p>
      </header>
      <nav aria-label="Artwork categories" className="mt-10 border-y border-line py-4">
        <ul className="flex flex-wrap gap-x-8 gap-y-2">
          <li>
            <a
              className="text-link exploration-category inline-flex min-h-11 items-center"
              href="/explore"
              aria-current={!query.category ? "page" : undefined}
            >
              All artworks
            </a>
          </li>
          {Object.entries(artworkCategoryLabels).map(([category, label]) => (
            <li key={category}>
              <a
                className="text-link exploration-category inline-flex min-h-11 items-center"
                href={`/explore?category=${category}`}
                aria-current={query.category === category ? "page" : undefined}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {state.kind === "INVALID_QUERY" ? (
        <div className="mt-10 max-w-reading">
          <h2 className="text-section">These filters aren&apos;t supported</h2>
          <p className="mt-4">
            Choose a category above or{" "}
            <a href="/explore" className="underline">
              reset the filters
            </a>
            .
          </p>
        </div>
      ) : state.kind === "UNAVAILABLE" ? (
        <div className="mt-10 max-w-reading">
          <h2 className="text-section">Artworks are unavailable right now</h2>
          <p role="alert" className="mt-4">
            We couldn&apos;t load the catalogue. Your filters are preserved.
          </p>
          <a className="button-primary mt-6 inline-flex" href={explorationUrl(query)}>
            Try again
          </a>
        </div>
      ) : (
        <>
          <p className="mt-8 text-sm text-muted">
            {query.category ? artworkCategoryLabels[query.category] : "All art forms"} ·
            Page {query.offset / explorationPageSize + 1}
            {state.page.items.length
              ? ` · ${state.page.items.length} ${state.page.items.length === 1 ? "work" : "works"} on this page`
              : ""}
          </p>
          {state.page.items.length ? (
            <ul className="mt-8 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
              {state.page.items.map((artwork) => {
                const photo = explorationPhotoUrl(apiOrigin, artwork.heroImage);
                return (
                  <li key={artwork.kathaId} className="min-w-0">
                    {photo && artwork.heroImage ? (
                      <ArtworkPhoto
                        src={photo}
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
                    <h2 className="mt-5 break-words text-2xl">
                      <a className="text-link" href={`/art/${artwork.kathaId}`}>
                        {artwork.title}
                      </a>
                    </h2>
                    <p className="mt-3 break-words text-muted">
                      Created by {artwork.artist.displayName}
                    </p>
                    {!photo && (
                      <p className="mt-2 text-sm text-muted">
                        {artworkCategoryLabels[artwork.category]} ·{" "}
                        {artwork.creationYear}
                      </p>
                    )}
                    <p className="mt-2 break-all font-mono text-xs text-muted">
                      {artwork.kathaId}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-10 max-w-reading">
              <h2 className="text-section">
                {query.offset
                  ? "No artworks on this page"
                  : "No published artworks yet"}
              </h2>
              <p className="mt-4 text-muted">
                {query.offset
                  ? "The catalogue may have changed since your last visit."
                  : query.category
                    ? `No ${artworkCategoryLabels[query.category]} works are available in the public catalogue yet.`
                    : "Documented artworks will appear here after verification, minting and publication."}
              </p>
              <a
                className="mt-6 inline-block underline"
                href={explorationUrl({ ...query, offset: 0 })}
              >
                {query.offset ? "Return to the first page" : "Reload this category"}
              </a>
            </div>
          )}
          <nav
            aria-label="Artwork pages"
            className="mt-12 flex flex-wrap gap-8 border-t border-line pt-6"
          >
            {query.offset > 0 && (
              <a
                className="text-link exploration-category inline-flex min-h-11 items-center"
                href={explorationUrl({
                  ...query,
                  offset: query.offset - explorationPageSize,
                })}
              >
                Previous artworks
              </a>
            )}
            {state.page.pagination.hasMore &&
              query.offset + explorationPageSize <= 100000 && (
                <a
                  className="text-link exploration-category inline-flex min-h-11 items-center"
                  href={explorationUrl({
                    ...query,
                    offset: query.offset + explorationPageSize,
                  })}
                >
                  Next artworks
                </a>
              )}
            {state.page.pagination.hasMore &&
              query.offset + explorationPageSize > 100000 && (
                <p>
                  More artworks exist beyond the public pagination limit. Choose an art
                  form to narrow the catalogue.
                </p>
              )}
          </nav>
        </>
      )}
    </section>
  );
}
