import Link from "next/link";
import type { PublicArtistDetail } from "@katha/shared";
import { explorationPageSize, explorationUrl } from "../lib/artwork-exploration";
import { artistWorksUrl, type ArtistWorks } from "../lib/artist-page";
import { utcDate } from "../lib/format";
import { ArtworkCard } from "./artwork-card";
import { ArtworkPhoto } from "./artwork-photo";
import { KathaMark } from "./ui/katha-mark";
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
      <section
        className="weave dk bg-madder-deep text-paper"
        style={{ padding: "clamp(40px, 6vw, 88px) 0" }}
      >
        <div
          className="wrap flex flex-wrap items-end"
          style={{ gap: "32px clamp(32px, 5vw, 72px)" }}
        >
          {artist.profileImageUrl ? (
            <div
              className="ph cut bg-madder"
              style={{
                flex: "0 1 300px",
                width: 300,
                maxWidth: "100%",
                aspectRatio: "4 / 5",
              }}
            >
              <ArtworkPhoto
                src={artist.profileImageUrl}
                alt={`Portrait of ${artist.displayName}, approved by the artist`}
                primary
              />
            </div>
          ) : (
            <div
              className="cut flex items-center justify-center bg-madder-dark"
              aria-hidden="true"
              style={{
                flex: "0 1 300px",
                width: 300,
                maxWidth: "100%",
                aspectRatio: "4 / 5",
              }}
            >
              <KathaMark size={96} variant="outline" />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 420px" }}>
            <p className="sm m-0 text-on-red-muted">Artist</p>
            <h1
              id="artist-name"
              className="serif m-0 font-semibold"
              style={{
                fontSize: "clamp(40px, 5.6vw, 80px)",
                lineHeight: 1,
                letterSpacing: "-0.015em",
                overflowWrap: "anywhere",
              }}
            >
              {artist.displayName}
            </h1>
            <p className="m-0 text-[19px] text-on-red">{artist.region}</p>
            <ul
              aria-label="Art traditions"
              className="m-0 flex list-none flex-wrap gap-2 p-0"
            >
              {artist.traditions.map((tradition, index) => (
                <li key={index} className="chip-light cut-s">
                  {tradition}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <Badge tone="ok">Profile verified</Badge>
              <span className="sm text-on-red-muted">
                Checked manually by Katha on{" "}
                <time dateTime={artist.verifiedAt}>{utcDate(artist.verifiedAt)}</time>
              </span>
            </div>
            {artist.publicLinks.length > 0 && (
              <ul
                aria-label="Public links"
                className="mt-2 mb-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0"
              >
                {artist.publicLinks.map((href, index) => (
                  <li key={index}>
                    <a
                      className="lnk-d inline-flex min-h-11 items-center gap-1.5"
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
          </div>
        </div>
      </section>

      <section
        aria-labelledby="artist-biography"
        className="bg-paper"
        style={{ padding: "clamp(56px, 7vw, 96px) 0 0" }}
      >
        <div
          className="wrap flex flex-wrap items-start"
          style={{ gap: "32px clamp(32px, 5vw, 80px)" }}
        >
          <div className="flex min-w-0 flex-col gap-4" style={{ flex: "2 1 520px" }}>
            <h2 id="artist-biography" className="h2">
              Biography
            </h2>
            <p className="reading p m-0">{artist.biography}</p>
          </div>
          <aside
            className="panel cut flex min-w-0 flex-col gap-2.5"
            style={{ flex: "1 1 280px" }}
          >
            <p className="serif m-0 text-xl font-semibold text-madder">
              Attribution stays with the artist
            </p>
            <p className="p sm">
              Every work by {artist.displayName} stays credited to them permanently,
              whoever owns it later. Buying a work doesn&apos;t transfer its copyright.
            </p>
            <p className="xs mut m-0">
              Profile verification records a manual check of the artist, not independent
              proof of every artwork&apos;s authenticity.
            </p>
          </aside>
        </div>
      </section>

      <section
        id="artist-works"
        aria-labelledby="artist-artworks"
        className="bg-paper"
        style={{ padding: "clamp(56px, 7vw, 96px) 0 clamp(72px, 8vw, 112px)" }}
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
