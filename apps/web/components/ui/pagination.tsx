import Link from "next/link";

// Catalogue APIs return `hasMore`, not a total, so pages are numbered without
// claiming a last page. Links stay client-side to keep the wallet session.
export function Pagination({
  label = "Pagination",
  page,
  summary,
  previousHref,
  nextHref,
  limitNote,
}: {
  label?: string;
  page: number;
  summary?: string;
  previousHref: string | null;
  nextHref: string | null;
  limitNote?: string | null;
}) {
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-4 border-t border-(--rule-soft) pt-6"
    >
      <p className="sm mut m-0">{summary ?? `Page ${page}`}</p>
      <div className="flex flex-wrap items-center gap-2">
        {previousHref ? (
          <Link className="btn btn-o btn-sm" href={previousHref}>
            Previous
          </Link>
        ) : (
          <button className="btn btn-o btn-sm" type="button" disabled>
            Previous
          </button>
        )}
        <span className="pg cut-s" aria-current="page">
          {page}
        </span>
        {nextHref ? (
          <Link className="btn btn-o btn-sm" href={nextHref}>
            Next
          </Link>
        ) : (
          <button className="btn btn-o btn-sm" type="button" disabled>
            Next
          </button>
        )}
      </div>
      {limitNote && <p className="sm mut m-0 basis-full">{limitNote}</p>}
    </nav>
  );
}
