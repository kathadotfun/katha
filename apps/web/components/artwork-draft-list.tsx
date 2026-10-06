"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HTTP_LIMITS } from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";
import {
  createArtworkDraftList,
  lockedDraftListSnapshot,
  type ArtworkDraftList,
} from "../lib/artwork-draft-list";
const emptySubscribe = () => () => {};
const serverAuth = () => signedOutSnapshot;
const serverList = () => lockedDraftListSnapshot;
export function ArtworkDraftListPanel() {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? serverAuth,
    serverAuth,
  );
  const [list, setList] = useState<ArtworkDraftList | null>(null);
  useEffect(() => {
    if (!session) return;
    const current = createArtworkDraftList(session);
    setList(current);
    return () => current.dispose();
  }, [session]);
  useEffect(() => {
    if (auth.status === "signed-in") void list?.refresh();
  }, [list, auth.status, auth.session]);
  const state = useSyncExternalStore(
    list?.subscribe ?? emptySubscribe,
    list?.getSnapshot ?? serverList,
    serverList,
  );
  if (!auth.session)
    return (
      <p className="mt-10" role="status">
        Connect your wallet and sign in to Katha in the header to view artwork drafts.
      </p>
    );
  const page = state.page;
  const busy = state.status === "loading";
  return (
    <section className="mt-10" aria-labelledby="draft-list-title" aria-busy={busy}>
      <h2 id="draft-list-title" className="text-2xl">
        Unpublished artworks
      </h2>
      {state.status === "ready" && (
        <Link href="/admin/artworks/new" className="text-link mt-5 inline-block">
          Document new artwork
        </Link>
      )}
      <p className="mt-3 text-sm text-muted">
        {auth.session.cluster === "devnet" ? "Devnet" : "Localnet"} test environment ·
        Administrative records
      </p>
      {state.status === "loading" && (
        <p role="status" className="mt-5">
          Loading artwork drafts…
        </p>
      )}
      {state.status === "locked" && (
        <p role="status" className="mt-5">
          Artwork draft access has not been confirmed.
        </p>
      )}
      {state.error && (
        <p role="alert" className="mt-5">
          {state.error}
        </p>
      )}
      <button
        type="button"
        className="text-link mt-5"
        disabled={!list || busy}
        onClick={() => void list?.refresh()}
      >
        {state.status === "unavailable" || state.status === "denied"
          ? "Try loading drafts again"
          : "Refresh drafts"}
      </button>
      {page && (
        <>
          <p role="status" className="mt-6">
            {page.items.length
              ? `Showing ${page.pagination.offset + 1}–${page.pagination.offset + page.items.length} unpublished artworks.`
              : "No unpublished artworks on this page. Drafts appear here after artwork documentation is created."}
          </p>
          <p className="mt-3 max-w-reading text-sm text-muted">
            “Lifecycle started” means stored documents or workflow records exist. It
            does not confirm a successful blockchain transaction. “Documenting” does not
            prove an artwork is unregistered on-chain.
          </p>
          <ul className="mt-6 grid gap-6 lg:grid-cols-2">
            {page.items.map((item) => (
              <li key={item.kathaId} className="min-w-0 border-t border-line py-6">
                <p className="text-sm font-mono break-all">{item.kathaId}</p>
                <h3 className="mt-3 text-2xl break-words">
                  <Link href={`/admin/artworks/${item.kathaId}`} className="text-link">
                    {item.title}
                  </Link>
                </h3>
                <p className="mt-3">
                  {item.artist.displayName} ·{" "}
                  {item.category === "PAUBHA"
                    ? "Paubha"
                    : item.category === "THANGKA"
                      ? "Thangka"
                      : "Mandala"}{" "}
                  · {item.creationYear}
                </p>
                <dl className="artwork-facts mt-4">
                  <div>
                    <dt>Artist profile</dt>
                    <dd>
                      {item.artist.verificationStatus === "VERIFIED"
                        ? "Verified artist"
                        : "Artist verification pending"}
                    </dd>
                  </div>
                  <div>
                    <dt>Artwork onboarding</dt>
                    <dd>
                      {item.workflowStatus === "DOCUMENTING"
                        ? "Documenting"
                        : "Lifecycle started"}
                    </dd>
                  </div>
                  <div>
                    <dt>Publication</dt>
                    <dd>Unpublished</dd>
                  </div>
                  <div>
                    <dt>Last documentation update</dt>
                    <dd>{item.updatedAt}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <nav aria-label="Artwork draft pages" className="mt-6 flex flex-wrap gap-6">
            <button
              type="button"
              className="text-link"
              disabled={busy || page.pagination.offset === 0}
              onClick={() => void list?.previous()}
            >
              Previous draft page
            </button>
            <button
              type="button"
              className="text-link"
              disabled={
                busy ||
                !page.pagination.hasMore ||
                page.pagination.offset + page.pagination.limit > HTTP_LIMITS.offset
              }
              onClick={() => void list?.next()}
            >
              Next draft page
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
