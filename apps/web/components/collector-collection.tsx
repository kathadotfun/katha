"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  ArtworkListingResponse,
  CollectorCollectionResponse,
} from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createCollectorCollection,
  collectionIdentity,
  lockedCollectionSnapshot,
  type CollectorCollection,
} from "../lib/collector-collection";
import { createPublicApi } from "../lib/public-api";
import { explorationPhotoUrl } from "../lib/artwork-exploration";
import { artworkCategoryLabels } from "../lib/artwork-page";
import { localDate, localTime, shortAddress } from "../lib/format";
import { signInHref } from "../lib/return-path";
import { ArtworkPhoto, PhotoPlaceholder } from "./artwork-photo";
import { Badge, Icon, Notice, type Tone } from "./ui/status";

const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverCollection = () => lockedCollectionSnapshot;

type Holding = CollectorCollectionResponse["items"][number];
const custody: Record<Holding["custody"]["state"], { tone: Tone; text: string }> = {
  UNKNOWN: { tone: "neu", text: "Not recorded" },
  KATHA_HELD: { tone: "neu", text: "Held by Katha" },
  COLLECTOR_HELD: { tone: "warn", text: "With you" },
  IN_TRANSIT: { tone: "info", text: "In transit" },
};

// Listing state leads; indexing lag is flagged without hiding the owner's actions.
function ownership(item: Holding, listing: ArtworkListingResponse | null | undefined) {
  const lagging = ["LAGGING", "STALE"].includes(item.indexing.status);
  const sub =
    listing === undefined
      ? "Checking listing…"
      : listing === null
        ? "Listing status unavailable"
        : listing.listing?.active
          ? "Locked until the listing ends"
          : listing.listing?.status === "ACTIVE"
            ? "Locked until you release it"
            : "Not listed";
  if (listing?.listing?.active)
    return { tone: "info" as Tone, text: "Listed for sale", sub };
  if (listing?.listing?.status === "ACTIVE")
    return { tone: "warn" as Tone, text: "Listing expired", sub };
  if (lagging) return { tone: "warn" as Tone, text: "Updating", sub };
  return { tone: "ok" as Tone, text: "In your wallet", sub };
}

function actions(item: Holding, listing: ArtworkListingResponse | null | undefined) {
  const id = item.artwork.kathaId;
  const record = { label: "View record", href: `/art/${id}`, primary: false };
  if (listing?.listing?.status === "ACTIVE")
    return [
      { label: "Manage listing", href: `/collection/${id}/list`, primary: true },
      record,
    ];
  if (item.custody.state === "COLLECTOR_HELD")
    return [
      { label: "Request inspection", href: `/collection/${id}/resale`, primary: true },
      { label: "Return to Katha", href: `/collection/${id}/delivery`, primary: false },
      record,
    ];
  if (item.custody.state === "IN_TRANSIT")
    return [
      { label: "Delivery status", href: `/collection/${id}/delivery`, primary: true },
      record,
    ];
  if (item.custody.state === "KATHA_HELD")
    return [
      { label: "List for sale", href: `/collection/${id}/list`, primary: true },
      { label: "Request delivery", href: `/collection/${id}/delivery`, primary: false },
      record,
    ];
  return [
    {
      label: "Inspection and resale",
      href: `/collection/${id}/resale`,
      primary: false,
    },
    record,
  ];
}

export function CollectorCollectionPanel({ apiOrigin }: { apiOrigin: string }) {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverAuth,
    serverAuth,
  );
  const [collection, setCollection] = useState<CollectorCollection | null>(null);
  useEffect(() => {
    if (!session) return;
    const api = createPublicApi(apiOrigin);
    const current = createCollectorCollection(session, (id, signal) =>
      api.listing(id, { signal }),
    );
    setCollection(current);
    return () => current.dispose();
  }, [session, apiOrigin]);
  useEffect(() => {
    if (auth.status === "signed-in") void collection?.refresh();
  }, [collection, auth.status, auth.session]);
  const raw = useSyncExternalStore(
    collection?.subscribe ?? emptySubscribe,
    collection?.getSnapshot ?? serverCollection,
    serverCollection,
  );
  // Private holdings disappear as soon as the session identity changes.
  const state =
    raw.identity === collectionIdentity(auth.session) ? raw : lockedCollectionSnapshot;
  const page = state.page;
  const delayed = page?.items.some((item) =>
    ["LAGGING", "STALE", "GAP_DETECTED"].includes(item.indexing.status),
  );
  return (
    <div className="app-main">
      <div className="wrap">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="h1">My collection</h1>
            {auth.session && (
              <p className="p text-lg">
                Artworks owned by{" "}
                <span className="id">{shortAddress(auth.session.walletAddress)}</span>
                {page && (
                  <>
                    , indexed as of{" "}
                    <time dateTime={page.evaluatedAt}>
                      {localTime(page.evaluatedAt)}
                    </time>
                  </>
                )}
                .
              </p>
            )}
          </div>
          {auth.session && (
            <button
              type="button"
              className="btn btn-o btn-sm"
              disabled={!collection || state.status === "loading"}
              onClick={() => void collection?.refresh()}
            >
              <Icon name="refresh" />
              Refresh
            </button>
          )}
        </div>

        {!auth.session ? (
          <div className="panel cut panel-empty mt-8">
            <p className="empty-title">Sign in to see your collection</p>
            <p className="p max-w-xl">
              Your collection, delivery requests and listings are private. Connect your
              wallet and sign in to view them.
            </p>
            <Link className="btn btn-p cut-s mt-2" href={signInHref("/collection")}>
              Sign in
            </Link>
          </div>
        ) : (
          <section
            aria-label="Indexed artwork collection"
            aria-busy={state.status === "loading"}
          >
            {delayed && (
              <Notice tone="warn" icon="clock" className="mt-7">
                <p>
                  <strong>Recent ownership changes are still being indexed.</strong> A
                  purchase finalized on Solana is yours even before it appears here; you
                  don&apos;t need to buy it again.
                </p>
              </Notice>
            )}
            {(state.status === "loading" || state.status === "locked") && (
              <div className="mt-8 flex flex-col gap-3">
                <p role="status" className="sr-only">
                  Loading your collection
                </p>
                {[1, 2, 3].map((key) => (
                  <div key={key} className="panel cut coll-row" aria-hidden="true">
                    <div className="skel cut-s ratio-art w-28" />
                    <div
                      className="flex flex-col gap-2.5"
                      style={{ flex: "1 1 260px" }}
                    >
                      <div className="skel h-4 w-1/5" />
                      <div className="skel h-6.5 w-[70%]" />
                      <div className="skel h-4 w-2/5" />
                    </div>
                    <div className="flex gap-5" style={{ flex: "1 1 300px" }}>
                      <div className="skel h-13 flex-1" />
                      <div className="skel h-13 flex-1" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {state.status === "unavailable" && (
              <div className="panel cut panel-empty mt-8" role="alert">
                <Badge tone="err" icon="error">
                  Collection unavailable
                </Badge>
                <p className="empty-title">Your collection couldn&apos;t load</p>
                <p className="p max-w-xl">
                  Katha&apos;s records service didn&apos;t respond. Nothing has changed
                  in your wallet. Try again in a moment.
                </p>
                <button
                  type="button"
                  className="btn btn-p cut-s mt-2"
                  onClick={() => void collection?.refresh()}
                >
                  Try again
                </button>
              </div>
            )}
            {page && page.items.length === 0 && (
              <div className="panel cut panel-empty mt-8">
                <p className="empty-title">
                  {page.pagination.offset
                    ? "No artworks on this page"
                    : "You don't own any artworks yet"}
                </p>
                <p className="p max-w-xl">
                  {page.pagination.offset
                    ? "Your collection may have changed since the last page loaded."
                    : "Works you buy on Katha appear here, with their ownership, custody and delivery options. If you just bought one, it can take a few minutes to show up."}
                </p>
                {page.pagination.offset ? (
                  <button
                    type="button"
                    className="btn btn-p cut-s mt-2"
                    onClick={() => void collection?.previous()}
                  >
                    Previous page
                  </button>
                ) : (
                  <Link className="btn btn-p cut-s mt-2" href="/explore">
                    Explore artworks
                  </Link>
                )}
              </div>
            )}
            {page && page.items.length > 0 && (
              <>
                <ul className="mt-8 flex list-none flex-col gap-3 p-0">
                  {page.items.map((item) => {
                    const { artwork } = item;
                    const photo = explorationPhotoUrl(apiOrigin, artwork.heroImage);
                    const listing = state.listings[artwork.kathaId];
                    const changedOwner = listing && listing.owner !== item.ownerWallet;
                    const own = ownership(item, listing);
                    const held = custody[item.custody.state];
                    return (
                      <li key={artwork.kathaId} className="panel cut coll-row">
                        <Link
                          className="ph ph-sm cut-s ratio-art w-28 flex-none"
                          href={`/art/${artwork.kathaId}`}
                          aria-label={`${artwork.title}, open artwork record`}
                        >
                          {photo && artwork.heroImage ? (
                            <ArtworkPhoto
                              src={photo}
                              alt={artwork.heroImage.altText}
                              fallbackSize={32}
                            />
                          ) : (
                            <PhotoPlaceholder label="Photo" size={32} />
                          )}
                        </Link>
                        <div
                          className="flex min-w-0 flex-col gap-1"
                          style={{ flex: "1 1 260px" }}
                        >
                          <span className="xs mut">
                            {artworkCategoryLabels[artwork.category]},{" "}
                            {artwork.creationYear}
                          </span>
                          <h2 className="serif m-0 text-[23px] leading-[1.2] font-semibold wrap-anywhere">
                            <Link
                              href={`/art/${artwork.kathaId}`}
                              className="text-madder no-underline hover:underline"
                            >
                              {artwork.title}
                            </Link>
                          </h2>
                          <p className="p sm">
                            by{" "}
                            <Link
                              className="lnk"
                              href={`/artists/${artwork.artist.slug}`}
                            >
                              {artwork.artist.displayName}
                            </Link>
                          </p>
                          <p className="xs mut m-0">
                            Katha ID{" "}
                            <span className="id text-ink">{artwork.kathaId}</span>
                          </p>
                        </div>
                        <div
                          className="grid min-w-0 gap-x-5 gap-y-3.5"
                          style={{
                            flex: "1 1 300px",
                            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                          }}
                        >
                          <div className="st">
                            <span className="st-k">Digital ownership</span>
                            <Badge tone={own.tone} className="self-start">
                              {own.text}
                            </Badge>
                            <span className="xs mut">{own.sub}</span>
                          </div>
                          <div className="st">
                            <span className="st-k">Physical custody</span>
                            <Badge tone={held.tone} className="self-start">
                              {held.text}
                            </Badge>
                            <span className="xs mut">
                              {item.custody.observedAt ? (
                                <>
                                  Recorded{" "}
                                  <time dateTime={item.custody.observedAt}>
                                    {localDate(item.custody.observedAt)}
                                  </time>
                                </>
                              ) : (
                                "No dated observation"
                              )}
                            </span>
                          </div>
                        </div>
                        <div
                          className="flex min-w-0 flex-col items-stretch gap-2"
                          style={{ flex: "1 1 200px" }}
                        >
                          {changedOwner ? (
                            <>
                              <p role="status" className="xs m-0 text-err">
                                Solana shows a different owner for this work. Refresh to
                                reconcile it.
                              </p>
                              <Link
                                className="btn btn-o btn-sm cut-s"
                                href={`/art/${artwork.kathaId}`}
                              >
                                View record
                              </Link>
                            </>
                          ) : (
                            actions(item, listing).map((action) => (
                              <Link
                                key={action.label}
                                className={`btn btn-sm cut-s ${action.primary ? "btn-p" : "btn-o"}`}
                                href={action.href}
                              >
                                {action.label}
                              </Link>
                            ))
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <nav
                  aria-label="Collection pages"
                  className="mt-10 flex flex-wrap items-center justify-between gap-4"
                >
                  <p className="sm mut m-0">
                    Showing {page.pagination.offset + 1}–
                    {page.pagination.offset + page.items.length}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-o btn-sm"
                      disabled={!page.pagination.offset}
                      onClick={() => void collection?.previous()}
                    >
                      Previous page
                    </button>
                    <span className="pg cut-s" aria-current="page">
                      {page.pagination.offset / 20 + 1}
                    </span>
                    <button
                      type="button"
                      className="btn btn-o btn-sm"
                      disabled={
                        !page.pagination.hasMore || page.pagination.offset >= 100000
                      }
                      onClick={() => void collection?.next()}
                    >
                      Next page
                    </button>
                  </div>
                </nav>
                <p className="xs mut mt-6 mb-0">
                  These are recorded observations, not a live ownership check or
                  physical inspection.
                </p>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
