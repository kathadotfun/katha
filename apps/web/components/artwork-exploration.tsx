import Link from "next/link";
import type { ArtworkCategory } from "@katha/shared";
import { artworkCategoryLabels } from "../lib/artwork-page";
import {
  explorationPageSize,
  explorationUrl,
  type ExplorationState,
  type ExplorationQuery,
} from "../lib/artwork-exploration";
import { ArtworkCard } from "./artwork-card";
import { Pagination } from "./ui/pagination";
import { Badge, Icon } from "./ui/status";
import { RetryButton } from "./ui/retry-button";

const categories: readonly (readonly [string, ArtworkCategory | undefined])[] = [
  ["All works", undefined],
  ...(Object.entries(artworkCategoryLabels) as [ArtworkCategory, string][]).map(
    ([category, label]) => [label, category] as const,
  ),
];

export function ArtworkExploration({
  state,
  apiOrigin,
}: {
  state: ExplorationState;
  apiOrigin: string;
}) {
  const query: ExplorationQuery =
    state.kind === "INVALID_QUERY" ? { offset: 0 } : state.query;
  // Discovery has no artist lookup by ID, so the chip names the artist from results.
  const artistName =
    state.kind === "READY" && query.artistId
      ? (state.page.items[0]?.artist.displayName ?? "Selected artist")
      : query.artistId
        ? "Selected artist"
        : null;
  const filtered = Boolean(query.category || query.artistId);
  const describe = (count: number) =>
    (query.category ? `${artworkCategoryLabels[query.category]} ` : "") +
    (count === 1 ? "work" : "works") +
    (artistName ? ` by ${artistName}` : "");
  const scope = describe(2);
  return (
    <div className="app-main">
      <div className="wrap">
        <div className="flex flex-col gap-3.5">
          <p className="kick">Catalogue</p>
          <h1 id="explore-title" className="h1">
            Artworks
          </h1>
          <p className="lead">
            Original paintings, each with a public record on Solana.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <nav aria-label="Filter by tradition" className="seg">
              {categories.map(([label, category]) => (
                <Link
                  key={label}
                  className="cut-s"
                  href={explorationUrl({
                    offset: 0,
                    ...(category ? { category } : {}),
                    ...(query.artistId ? { artistId: query.artistId } : {}),
                  })}
                  aria-current={query.category === category ? "page" : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {artistName && (
              <div className="filter-chip cut-s">
                <span>Artist: {artistName}</span>
                <Link
                  href={explorationUrl({
                    offset: 0,
                    ...(query.category ? { category: query.category } : {}),
                  })}
                  aria-label="Remove artist filter"
                >
                  <Icon name="close" />
                </Link>
              </div>
            )}
            {filtered && (
              <Link className="lnk inline-flex min-h-11 items-center" href="/explore">
                Reset filters
              </Link>
            )}
          </div>
          {state.kind === "READY" && state.page.items.length > 0 && (
            <p className="sm mut m-0" aria-live="polite">
              Showing{" "}
              {state.page.items.length === 1
                ? query.offset + 1
                : `${query.offset + 1}–${query.offset + state.page.items.length}`}{" "}
              of {state.page.pagination.total} {describe(state.page.pagination.total)}
            </p>
          )}
        </div>

        {state.kind === "INVALID_QUERY" ? (
          <div className="panel cut panel-empty mt-10">
            <h2 className="h2">These filters aren&apos;t supported</h2>
            <p className="p max-w-xl">
              Choose a tradition above, or reset your filters to see every published
              work.
            </p>
            <Link className="btn btn-p cut-s mt-2.5" href="/explore">
              Reset filters
            </Link>
          </div>
        ) : state.kind === "UNAVAILABLE" ? (
          <div className="panel cut panel-empty mt-10" role="alert">
            <Badge tone="err" icon="error">
              Catalogue unavailable
            </Badge>
            <h2 className="h2">Artworks couldn&apos;t load</h2>
            <p className="p max-w-xl">
              The Katha catalogue didn&apos;t respond. Your filters are kept, so you can
              try again in a moment.
            </p>
            <RetryButton className="btn btn-p cut-s mt-2.5" />
          </div>
        ) : state.page.items.length ? (
          <>
            <div className="grid-cards mt-10">
              {state.page.items.map((artwork) => (
                <ArtworkCard
                  key={artwork.kathaId}
                  artwork={artwork}
                  apiOrigin={apiOrigin}
                />
              ))}
            </div>
            <div className="mt-18">
              <ExplorationPages state={state} query={query} />
            </div>
          </>
        ) : query.offset ? (
          <div className="panel cut panel-empty mt-10">
            <h2 className="h2">No artworks on this page</h2>
            <p className="p max-w-xl">
              The catalogue may have changed since your last visit.
            </p>
            <Link
              className="btn btn-p cut-s mt-2.5"
              href={explorationUrl({ ...query, offset: 0 })}
            >
              Return to the first page
            </Link>
          </div>
        ) : (
          <div className="panel cut panel-empty mt-10">
            <h2 className="h2">No {scope} yet</h2>
            <p className="p max-w-xl">
              {filtered
                ? "Try another tradition, or reset your filters to see every published work."
                : "Works appear here once Katha has verified, minted and published them."}
            </p>
            {filtered && (
              <Link className="btn btn-p cut-s mt-2.5" href="/explore">
                Reset filters
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ExplorationPages({
  state,
  query,
}: {
  state: Extract<ExplorationState, { kind: "READY" }>;
  query: ExplorationQuery;
}) {
  const more = state.page.pagination.hasMore;
  const withinLimit = query.offset + explorationPageSize <= 100000;
  return (
    <Pagination
      page={query.offset / explorationPageSize + 1}
      pageCount={Math.ceil(state.page.pagination.total / explorationPageSize)}
      previousHref={
        query.offset > 0
          ? explorationUrl({ ...query, offset: query.offset - explorationPageSize })
          : null
      }
      nextHref={
        more && withinLimit
          ? explorationUrl({ ...query, offset: query.offset + explorationPageSize })
          : null
      }
      limitNote={
        more && !withinLimit
          ? "More artworks exist beyond the public page limit. Choose a tradition to narrow the catalogue."
          : null
      }
    />
  );
}
