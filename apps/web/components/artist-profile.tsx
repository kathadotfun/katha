import Link from "next/link";
import type { PublicArtistDetail } from "@katha/shared";
import { explorationPageSize, explorationUrl } from "../lib/artwork-exploration";
import { artistWorksUrl, type ArtistWorks } from "../lib/artist-page";
import { utcDate } from "../lib/format";
import { ArtworkCard } from "./artwork-card";
import { ArtworkPhoto } from "./artwork-photo";
import { Pagination } from "./ui/pagination";
import { Badge, Icon } from "./ui/status";
import { RetryButton } from "./ui/retry-button";

function linkLabel(href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

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
    <article aria-labelledby="artist-name">
      <div className="wrap pt-12">
        <section className="card warm pad-l" aria-labelledby="artist-name">
          <div className="flex flex-wrap items-center gap-x-9 gap-y-7">
            <div
              className="artist-portrait"
              role={artist.profileImageUrl ? undefined : "img"}
              aria-label={
                artist.profileImageUrl
                  ? undefined
                  : `No portrait supplied for ${artist.displayName}`
              }
            >
              {artist.profileImageUrl ? (
                <ArtworkPhoto
                  src={artist.profileImageUrl}
                  alt={`Portrait of ${artist.displayName}, approved by the artist`}
                  primary
                />
              ) : (
                artist.displayName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join("")
              )}
            </div>
            <div className="min-w-0 flex-1 basis-[360px]">
              <Badge tone="ok">Profile verified</Badge>
              <h1 id="artist-name" className="h1 mt-3 wrap-break-word">
                {artist.displayName}
              </h1>
              <p className="p mt-2">{artist.region}</p>
              <ul
                aria-label="Art traditions"
                className="mt-3 mb-0 flex list-none flex-wrap gap-2 p-0"
              >
                {artist.traditions.map((tradition, index) => (
                  <li key={index} className="chip-cat">
                    {tradition}
                  </li>
                ))}
              </ul>
            </div>
            <dl className="kv-direct min-w-0 basis-[260px]">
              <dt>Profile checked</dt>
              <dd>
                <time dateTime={artist.verifiedAt}>{utcDate(artist.verifiedAt)}</time>
              </dd>
              <dt>Published works</dt>
              <dd>
                {works.kind === "READY" ? works.page.pagination.total : "Unavailable"}
              </dd>
            </dl>
          </div>
          <h2 id="artist-biography" className="sr-only">
            Biography
          </h2>
          <p className="reading p mt-6">{artist.biography}</p>
          {artist.publicLinks.length > 0 && (
            <ul
              aria-label="Public links"
              className="mt-4 mb-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0"
            >
              {artist.publicLinks.map((href, index) => (
                <li key={index}>
                  <a
                    className="lnk inline-flex min-h-11 items-center gap-1.5"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {linkLabel(href)}
                    <Icon name="external" size={14} />
                    <span className="sr-only">, artist link, opens in a new tab</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <details className="more mt-3">
            <summary>Attribution stays with the artist</summary>
            <p className="p sm max-w-3xl">
              Every work by {artist.displayName} stays credited to them permanently,
              whoever owns it later. Buying a work doesn&apos;t transfer its copyright.
              Profile verification records a manual check of the artist, not independent
              proof of every artwork&apos;s authenticity.
            </p>
          </details>
        </section>
      </div>

      <section
        id="artist-works"
        aria-labelledby="artist-artworks"
        className=""
        style={{ padding: "clamp(48px, 6vw, 72px) 0 clamp(72px, 8vw, 112px)" }}
      >
        <div className="wrap">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b-[1.5px] border-(--rule-strong) pb-5">
            <h2 id="artist-artworks" className="h2">
              Published works
            </h2>
            {works.kind === "READY" && works.page.items.length > 0 && (
              <Link
                className="lnk py-2"
                href={explorationUrl({ offset: 0, artistId: artist.id })}
              >
                See all in Explore
              </Link>
            )}
          </div>
          {works.kind === "INVALID_QUERY" ? (
            <div className="panel cut panel-empty mt-10">
              <p className="empty-title">This page number isn&apos;t supported</p>
              <Link
                className="btn btn-p cut-s mt-2"
                href={artistWorksUrl(artist.slug, 0)}
              >
                Return to the first page
              </Link>
            </div>
          ) : works.kind === "UNAVAILABLE" ? (
            <div className="panel cut panel-empty mt-10" role="alert">
              <Badge tone="err" icon="error">
                Catalogue unavailable
              </Badge>
              <p className="empty-title">Works couldn&apos;t load</p>
              <p className="p max-w-xl">
                The profile loaded, but the catalogue didn&apos;t respond. Try again in
                a moment.
              </p>
              <RetryButton className="btn btn-p cut-s mt-2" />
            </div>
          ) : works.page.items.length ? (
            <>
              <div className="grid-cards mt-10">
                {works.page.items.map((artwork) => (
                  <ArtworkCard
                    key={artwork.kathaId}
                    artwork={artwork}
                    apiOrigin={apiOrigin}
                    heading="h3"
                    showArtist={false}
                  />
                ))}
              </div>
              <div className="mt-16">
                <Pagination
                  label="Artist artwork pages"
                  page={works.offset / explorationPageSize + 1}
                  pageCount={Math.ceil(
                    works.page.pagination.total / explorationPageSize,
                  )}
                  previousHref={
                    works.offset > 0
                      ? artistWorksUrl(artist.slug, works.offset - explorationPageSize)
                      : null
                  }
                  nextHref={
                    works.page.pagination.hasMore &&
                    works.offset + explorationPageSize <= 100000
                      ? artistWorksUrl(artist.slug, works.offset + explorationPageSize)
                      : null
                  }
                />
              </div>
            </>
          ) : works.offset ? (
            <div className="panel cut panel-empty mt-10">
              <p className="empty-title">No published works on this page</p>
              <p className="p max-w-xl">
                The catalogue may have changed since your last visit.
              </p>
              <Link
                className="btn btn-p cut-s mt-2"
                href={artistWorksUrl(artist.slug, 0)}
              >
                Return to the first page
              </Link>
            </div>
          ) : (
            <div className="panel cut panel-empty mt-10">
              <p className="empty-title">No published works yet</p>
              <p className="p max-w-xl">
                {artist.displayName}&apos;s works are still being documented and
                inspected. They&apos;ll appear here once Katha publishes them. This
                doesn&apos;t mean the artist has created no works.
              </p>
              <Link className="btn btn-p cut-s mt-2" href="/explore">
                Explore other artworks
              </Link>
            </div>
          )}
        </div>
      </section>
    </article>
  );
}
