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
import { artworkCategoryLabels } from "../lib/artwork-page";
import { localDateTime } from "../lib/format";
import { signInHref } from "../lib/return-path";
import { Badge, Icon } from "./ui/status";

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
  const page = state.page;
  const busy =
    state.status === "loading" || (Boolean(auth.session) && state.status === "locked");
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-2.5">
          <h1 className="h1 h1-ops">Artworks</h1>
          <p className="p text-lg">
            Every artwork record before publication, from first draft onward.
          </p>
        </div>
        {state.status !== "denied" && auth.session && (
          <Link className="btn btn-p cut-s" href="/admin/artworks/new">
            <Icon name="plus" />
            New artwork
          </Link>
        )}
      </div>

      {!auth.session ? (
        <div className="panel cut panel-empty mt-8">
          <p className="empty-title">Sign in to open the workspace</p>
          <p className="p max-w-[38rem]">
            The artwork workspace needs a signed-in administrator wallet.
          </p>
          <Link className="btn btn-p cut-s mt-2" href={signInHref("/admin/artworks")}>
            Sign in
          </Link>
        </div>
      ) : busy ? (
        <div className="tblbox cut mt-8 flex flex-col gap-3.5 p-5" aria-busy="true">
          <p role="status" className="sr-only">
            Loading artwork records
          </p>
          {[1, 2, 3, 4, 5, 6].map((key) => (
            <div key={key} aria-hidden="true" className="flex gap-4">
              <div className="skel h-[22px] flex-[3]" />
              <div className="skel h-[22px] flex-[2]" />
              <div className="skel h-[22px] flex-1" />
              <div className="skel h-[22px] flex-[2]" />
              <div className="skel h-[22px] flex-1" />
            </div>
          ))}
        </div>
      ) : state.status === "denied" ? (
        <div className="panel cut panel-empty mt-8">
          <Badge tone="err" icon="lock">
            Permission denied
          </Badge>
          <p className="empty-title">This workspace needs an administrator role</p>
          <p className="p max-w-[38rem]">
            {state.error ??
              "Your wallet can verify and inspect artworks, but can't open drafts."}{" "}
            Use the verifier lookup to open a specific work.
          </p>
          <Link className="btn btn-p cut-s mt-2" href="/admin">
            Go to verifier lookup
          </Link>
        </div>
      ) : state.status === "unavailable" ? (
        <div className="panel cut panel-empty mt-8" role="alert">
          <Badge tone="err" marker={false}>
            Service unavailable
          </Badge>
          <p className="empty-title">Artwork records couldn&apos;t load</p>
          <p className="p max-w-[38rem]">
            Katha&apos;s records service didn&apos;t respond. No changes were lost. Try
            again in a moment.
          </p>
          <button
            type="button"
            className="btn btn-p cut-s mt-2"
            onClick={() => void list?.refresh()}
          >
            Try again
          </button>
        </div>
      ) : page && page.items.length === 0 ? (
        <div className="panel cut panel-empty mt-8">
          <p className="empty-title">
            {page.pagination.offset ? "No artworks on this page" : "No artworks yet"}
          </p>
          <p className="p max-w-[38rem]">
            Create the first record once its artist profile exists. Katha issues the
            permanent ID when you save it.
          </p>
          <Link className="btn btn-p cut-s mt-2" href="/admin/artworks/new">
            New artwork
          </Link>
        </div>
      ) : page ? (
        <>
          <div
            className="tblbox cut mt-8"
            role="region"
            aria-label="Artwork records, scrolls sideways on small screens"
            tabIndex={0}
          >
            <table className="tbl tbl-wide">
              <caption className="sr-only">Artwork records</caption>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Katha ID</th>
                  <th scope="col">Tradition</th>
                  <th scope="col">Year</th>
                  <th scope="col">Artist</th>
                  <th scope="col">Artist profile</th>
                  <th scope="col">Workflow</th>
                  <th scope="col">Updated</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr key={item.kathaId}>
                    <td className="max-w-[260px]">
                      <Link
                        href={`/admin/artworks/${item.kathaId}`}
                        className="font-semibold text-madder no-underline hover:underline wrap-anywhere"
                      >
                        {item.title}
                      </Link>
                    </td>
                    <td className="id whitespace-nowrap">{item.kathaId}</td>
                    <td>{artworkCategoryLabels[item.category]}</td>
                    <td>{item.creationYear}</td>
                    <td>{item.artist.displayName}</td>
                    <td>
                      <Badge
                        tone={
                          item.artist.verificationStatus === "VERIFIED" ? "ok" : "warn"
                        }
                        marker={false}
                      >
                        {item.artist.verificationStatus === "VERIFIED"
                          ? "Verified"
                          : "Not verified"}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={item.workflowStatus === "DOCUMENTING" ? "neu" : "info"}
                      >
                        {item.workflowStatus === "DOCUMENTING"
                          ? "Documenting"
                          : "Lifecycle started"}
                      </Badge>
                    </td>
                    <td className="mut whitespace-nowrap">
                      {localDateTime(item.updatedAt)}
                    </td>
                    <td>
                      <Link
                        className="btn btn-o btn-sm"
                        href={`/admin/artworks/${item.kathaId}`}
                        aria-label={`Open ${item.title}`}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="xs mut mt-3 mb-0">
            &ldquo;Lifecycle started&rdquo; means stored documents or workflow records
            exist; it doesn&apos;t confirm a blockchain transaction.
            &ldquo;Documenting&rdquo; doesn&apos;t prove a work is unregistered on
            chain.
          </p>
          <nav
            aria-label="Artwork draft pages"
            className="mt-6 flex flex-wrap items-center justify-between gap-4"
          >
            <p className="sm mut m-0" role="status">
              Showing {page.pagination.offset + 1}–
              {page.pagination.offset + page.items.length} of {page.pagination.total},
              newest first
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-o btn-sm"
                disabled={busy || page.pagination.offset === 0}
                onClick={() => void list?.previous()}
              >
                Previous
              </button>
              <span className="pg cut-s" aria-current="page">
                {page.pagination.offset / page.pagination.limit + 1}
                <span className="sr-only">
                  {" "}
                  of{" "}
                  {Math.max(
                    1,
                    Math.ceil(page.pagination.total / page.pagination.limit),
                  )}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-o btn-sm"
                disabled={
                  busy ||
                  !page.pagination.hasMore ||
                  page.pagination.offset + page.pagination.limit > HTTP_LIMITS.offset
                }
                onClick={() => void list?.next()}
              >
                Next
              </button>
            </div>
          </nav>
        </>
      ) : null}
    </>
  );
}
