import Link from "next/link";
import type { NfcTagStatusResponse } from "@katha/shared";
import { Badge, type Tone } from "./ui/status";

type Problem = Exclude<NfcTagStatusResponse["state"], "ACTIVE"> | "UNAVAILABLE";

const states: Readonly<
  Record<
    Problem,
    { tone: Tone; badge: string; title: string; body: string; advice: string }
  >
> = {
  UNKNOWN: {
    tone: "err",
    badge: "Unknown tag",
    title: "This tag isn’t linked to a Katha artwork",
    body: "We couldn’t find a record for this tag. It may not be a Katha tag, or it may not have been assigned to a work yet.",
    advice: "Without a Katha record, treat the painting as unverified.",
  },
  RETIRED: {
    tone: "warn",
    badge: "Retired tag",
    title: "This tag has been retired",
    body: "This tag no longer identifies an artwork. Katha retires a tag when it’s replaced or removed from a painting.",
    advice:
      "If this tag is still attached to a painting, don’t rely on it to identify the work.",
  },
  UNPUBLISHED: {
    tone: "info",
    badge: "Not published yet",
    title: "This artwork isn’t published yet",
    body: "This tag belongs to a work that Katha is still documenting. Its public record will open here once it’s published.",
    advice: "Until then, there’s no public record to compare the painting against.",
  },
  UNAVAILABLE: {
    tone: "warn",
    badge: "Check unavailable",
    title: "We couldn’t check this tag right now",
    body: "Katha’s records didn’t respond. Nothing about the tag has changed.",
    advice: "Try again in a moment before relying on the tag.",
  },
};

// A tapped tag only points to a record; none of these states says anything
// about the painting's authenticity, ownership or custody.
export function TagStatus({
  tagId,
  state,
  checkedAt,
}: {
  tagId: string;
  state: Problem;
  checkedAt: string;
}) {
  const view = states[state];
  return (
    <div className="app-main">
      <div className="wrap">
        <section
          className="panel cut flex max-w-[760px] flex-col items-start gap-4"
          style={{ padding: "clamp(28px, 5vw, 64px)" }}
          aria-labelledby="tag-title"
        >
          <Badge tone={view.tone} role="status">
            {view.badge}
          </Badge>
          <h1 id="tag-title" className="h1">
            {view.title}
          </h1>
          <p className="p text-lg">{view.body}</p>
          <dl className="m-0 w-full">
            <div className="kv">
              <dt>Tag reference</dt>
              <dd className="id">{tagId}</dd>
            </div>
            <div className="kv">
              <dt>Checked</dt>
              <dd>
                <time dateTime={checkedAt}>
                  {new Date(checkedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </time>
              </dd>
            </div>
          </dl>
          <p className="p">
            <strong>{view.advice}</strong> A tag can be copied or moved, so even a
            working tag only points to a record; it doesn’t prove authenticity.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
            {state === "UNAVAILABLE" ? (
              <Link className="btn btn-p cut-s" href={`/tags/${tagId}`}>
                Try again
              </Link>
            ) : (
              <Link className="btn btn-p cut-s" href="/explore">
                Explore artworks
              </Link>
            )}
            <Link className="lnk" href="/">
              Go to the home page
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
