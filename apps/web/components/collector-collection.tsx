"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
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
import { ArtworkPhoto } from "./artwork-photo";
const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverCollection = () => lockedCollectionSnapshot;
const custodyLabels = {
  UNKNOWN: "Custody unconfirmed",
  KATHA_HELD: "In Katha custody",
  COLLECTOR_HELD: "Collector-held",
  IN_TRANSIT: "In transit",
};
const indexingLabels = {
  UNKNOWN: "Indexing freshness unconfirmed",
  GAP_DETECTED: "Indexing gap detected",
  LAGGING: "Indexing is catching up",
  STALE: "Indexing observation is stale",
  AT_OBSERVED_HEAD: "Indexed through the last observed finalized head",
};
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
  const state =
    raw.identity === collectionIdentity(auth.session) ? raw : lockedCollectionSnapshot;
  if (!auth.session)
    return (
      <div className="mt-8">
        <p role="status">
          Connect your wallet and sign in to Katha to view your collection.
        </p>
        <Link href="/account" className="button-primary mt-5">
          Go to my account
        </Link>
      </div>
    );
  return (
    <section
      className="mt-8"
      aria-label="Indexed artwork collection"
      aria-busy={state.status === "loading"}
    >
      <p className="text-sm text-muted">
        {auth.session.cluster === "devnet" ? "Devnet" : "Localnet"} · Test environment
      </p>
      <p className="mt-3 max-w-reading text-sm text-muted">
        Ownership and custody observations can lag. Listing status is checked separately
        at finalized commitment and does not move the physical artwork.
      </p>
      {state.status === "loading" && (
        <div role="status" className="mt-6">
          <div aria-hidden="true" className="h-24 bg-line" />
          <p className="mt-3">Loading your collection…</p>
        </div>
      )}
      {state.status === "unavailable" && (
        <p role="alert" className="mt-6">
          Your collection could not be loaded. Check the API connection and try again.
        </p>
      )}
      <button
        type="button"
        className="site-nav-link mt-4"
        disabled={!collection || state.status === "loading"}
        onClick={() => void collection?.refresh()}
      >
        {state.status === "unavailable" ? "Try again" : "Refresh collection"}
      </button>
      {state.page && (
        <>
          <p className="mt-4 text-sm text-muted">
            Page {state.page.pagination.offset / 20 + 1} · Evaluated{" "}
            <time dateTime={state.page.evaluatedAt}>{state.page.evaluatedAt}</time>
          </p>
          {state.page.items.length === 0 ? (
            <div className="mt-8">
              <h2 className="text-2xl">
                {state.page.pagination.offset
                  ? "No artworks on this page"
                  : "No published artworks are indexed to this wallet yet"}
              </h2>
              <p className="mt-3 text-muted">
                An empty page may reflect indexing delay or unpublished work.
              </p>
              <Link
                href="/explore"
                className="text-link mt-4 inline-flex min-h-11 items-center"
              >
                Explore Nepali art
              </Link>
            </div>
          ) : (
            <ul className="mt-8 grid gap-10 md:grid-cols-2">
              {state.page.items.map((item) => {
                const { artwork } = item;
                const photo = explorationPhotoUrl(apiOrigin, artwork.heroImage);
                const listing = state.listings[artwork.kathaId];
                const changedOwner = listing && listing.owner !== item.ownerWallet;
                return (
                  <li
                    className="min-w-0 border-t border-line pt-6"
                    key={artwork.kathaId}
                  >
                    {photo && artwork.heroImage ? (
                      <ArtworkPhoto
                        src={photo}
                        alt={artwork.heroImage.altText}
                        caption={`${artworkCategoryLabels[artwork.category]} · ${artwork.creationYear}`}
                      />
                    ) : (
                      <p className="bg-surface p-6 text-muted">
                        Artwork photography is unavailable.
                      </p>
                    )}
                    <h2 className="mt-5 break-words text-2xl">
                      <Link className="text-link" href={`/art/${artwork.kathaId}`}>
                        {artwork.title}
                      </Link>
                    </h2>
                    <p className="mt-2">
                      <Link
                        href={`/artists/${artwork.artist.slug}`}
                        className="text-link"
                      >
                        {artwork.artist.displayName}
                      </Link>
                    </p>
                    <p className="mt-2 font-mono text-sm">{artwork.kathaId}</p>
                    <dl className="mt-5 space-y-4 text-sm">
                      <div>
                        <dt className="eyebrow text-muted">Indexed digital owner</dt>
                        <dd className="mt-1 break-all font-mono">{item.ownerWallet}</dd>
                      </div>
                      <div>
                        <dt className="eyebrow text-muted">Physical custody</dt>
                        <dd className="mt-1">
                          {custodyLabels[item.custody.state]}
                          {item.custody.observedAt && (
                            <>
                              {" "}
                              ·{" "}
                              <time dateTime={item.custody.observedAt}>
                                {item.custody.observedAt}
                              </time>
                            </>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="eyebrow text-muted">
                          Finalized listing observation
                        </dt>
                        <dd className="mt-1">
                          {listing === undefined
                            ? "Checking listing…"
                            : listing === null
                              ? "Listing status unavailable"
                              : listing.listing === null
                                ? "No listing recorded"
                                : listing.listing.active
                                  ? "Active listing"
                                  : listing.listing.status === "ACTIVE"
                                    ? "Listing expired; release not yet recorded"
                                    : `${listing.listing.status.charAt(0)}${listing.listing.status.slice(1).toLowerCase()} listing`}
                        </dd>
                      </div>
                      <div>
                        <dt className="eyebrow text-muted">Indexing</dt>
                        <dd className="mt-1">{indexingLabels[item.indexing.status]}</dd>
                      </div>
                      <div>
                        <dt className="eyebrow text-muted">Core owner check</dt>
                        <dd className="mt-1">
                          {item.indexing.ownerCheck
                            ? `${item.indexing.ownerCheck.status} · ${item.indexing.ownerCheck.checkedAt}`
                            : "No reconciliation available"}
                        </dd>
                      </div>
                    </dl>
                    {changedOwner && (
                      <p role="status" className="mt-4 text-brand">
                        The finalized listing lookup observed another Core owner.
                        Refresh to reconcile this indexed holding.
                      </p>
                    )}
                    <p className="mt-4 break-all text-sm text-muted">
                      Core asset: <span className="font-mono">{item.assetAddress}</span>
                    </p>
                    {!changedOwner && listing && (
                      <Link
                        href={`/collection/${artwork.kathaId}/list`}
                        className="text-link mt-4 inline-flex min-h-11 items-center"
                      >
                        {listing.listing?.status === "ACTIVE"
                          ? "Manage this listing"
                          : "Offer this artwork for sale"}
                      </Link>
                    )}
                    {!changedOwner && (
                      <Link
                        href={`/collection/${artwork.kathaId}/delivery`}
                        className="text-link mt-4 ml-4 inline-flex min-h-11 items-center"
                      >
                        Delivery and receipt
                      </Link>
                    )}
                    {!changedOwner && (
                      <Link
                        href={`/collection/${artwork.kathaId}/resale`}
                        className="text-link mt-4 ml-4 inline-flex min-h-11 items-center"
                      >
                        Inspection and resale
                      </Link>
                    )}
                    <p className="mt-3 text-sm text-muted">
                      These are recorded observations, not a live ownership or physical
                      inspection guarantee.
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <nav aria-label="Collection pages" className="mt-8 flex gap-6">
            <button
              type="button"
              className="site-nav-link"
              disabled={!state.page.pagination.offset}
              onClick={() => void collection?.previous()}
            >
              Previous page
            </button>
            <button
              type="button"
              className="site-nav-link"
              disabled={
                !state.page.pagination.hasMore || state.page.pagination.offset >= 100000
              }
              onClick={() => void collection?.next()}
            >
              Next page
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
