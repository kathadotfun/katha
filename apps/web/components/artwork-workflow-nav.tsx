"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ArtworkWorkflowResponse, ArtworkWorkflowState } from "@katha/shared";
import { useWalletSession } from "./wallet-provider";
import { signedOutSnapshot } from "../lib/wallet-session";

export const workflowSections = [
  {
    slug: "",
    step: "documentation",
    tab: "Documentation",
    title: "Artwork documentation",
  },
  {
    slug: "registration",
    step: "registration",
    tab: "Registration",
    title: "Registration",
  },
  {
    slug: "verification",
    step: "verification",
    tab: "Verification",
    title: "Authenticity verification",
  },
  {
    slug: "condition",
    step: "condition",
    tab: "Condition",
    title: "Condition inspection",
  },
  {
    slug: "custody",
    step: "custody",
    tab: "Custody",
    title: "Custody and fulfillment",
  },
  { slug: "media", step: "media", tab: "Media", title: "Media management" },
  {
    slug: "minting",
    step: "minting",
    tab: "Minting",
    title: "Minting and publication",
  },
  { slug: "metadata", step: "metadata", tab: "Metadata", title: "Metadata revisions" },
] as const;

const WorkflowContext = createContext<ArtworkWorkflowResponse | null>(null);
const noop = () => () => {};
const signedOut = () => signedOutSnapshot;

// Tab markers come from one protected read of Katha's records. They help
// navigation only; each page still checks and states its own exact status.
export function ArtworkWorkflowProvider({
  kathaId,
  children,
}: {
  kathaId: string;
  children: ReactNode;
}) {
  const session = useWalletSession();
  const auth = useSyncExternalStore(
    session?.subscribe ?? noop,
    session?.getSnapshot ?? signedOut,
    signedOut,
  );
  const pathname = usePathname() ?? "";
  const [workflow, setWorkflow] = useState<{
    key: string;
    value: ArtworkWorkflowResponse;
  } | null>(null);
  const key = auth.session
    ? `${auth.session.walletId}:${auth.session.expiresAt}:${kathaId}`
    : null;
  useEffect(() => {
    if (!session || !key) return;
    const abort = new AbortController();
    // Refreshed on every tab change, since work on one page changes the others.
    session
      .permissions(abort.signal)
      .then((roles) =>
        roles.admin || roles.verifier
          ? session.readArtworkWorkflow(
              kathaId,
              roles.admin ? "admin" : "verifier",
              abort.signal,
            )
          : null,
      )
      .then((value) => {
        if (value && !abort.signal.aborted) setWorkflow({ key, value });
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [session, key, kathaId, pathname]);
  // Private status never survives a sign-out or wallet change.
  const value = workflow && workflow.key === key ? workflow.value : null;
  return <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>;
}

const markers: Readonly<Record<ArtworkWorkflowState, { cls: string; sr: string }>> = {
  COMPLETE: { cls: " dm-ok", sr: ", done" },
  PENDING: { cls: " dm-now", sr: ", in progress" },
  NOT_STARTED: { cls: "", sr: ", not started" },
};

export function ArtworkWorkflowNav({ kathaId }: { kathaId: string }) {
  const workflow = useContext(WorkflowContext);
  const pathname = usePathname() ?? "";
  const base = `/admin/artworks/${kathaId}`;
  const slug = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : "";
  const current =
    workflowSections.find((section) => section.slug === slug) ?? workflowSections[0];
  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link className="lnk" href="/admin/artworks">
          Artworks
        </Link>
        <span aria-hidden="true">/</span>
        {current.slug ? (
          <>
            <Link className="lnk id" href={base}>
              {kathaId}
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{current.tab}</span>
          </>
        ) : (
          <span aria-current="page" className="id">
            {kathaId}
          </span>
        )}
      </nav>
      <div className="mt-3 flex min-w-0 flex-col gap-1.5">
        <h1 className="h1 h1-ops">{current.title}</h1>
        <p className="p sm">
          Katha ID <span className="id text-ink">{kathaId}</span>
        </p>
      </div>
      <nav className="tabs mt-5" aria-label="Artwork workflows">
        {workflowSections.map((section) => {
          const marker = workflow ? markers[workflow.steps[section.step]] : null;
          return (
            <Link
              key={section.tab}
              href={section.slug ? `${base}/${section.slug}` : base}
              aria-current={section === current ? "page" : undefined}
              // The status joins the name directly; a separate hidden span would
              // add a stray space before the comma.
              aria-label={marker ? `${section.tab}${marker.sr}` : undefined}
            >
              <span className={`dm${marker?.cls ?? ""}`} aria-hidden="true" />
              {section.tab}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function PublicationPath({ kathaId }: { kathaId: string }) {
  const workflow = useContext(WorkflowContext);
  const base = `/admin/artworks/${kathaId}`;
  const steps = [
    ["Documentation", base, "Title, measurements, materials and story"],
    [
      "Registration",
      `${base}/registration`,
      "Permanent identity and metadata fingerprint",
    ],
    [
      "Authenticity verification",
      `${base}/verification`,
      "A verifier's in-person check",
    ],
    ["Initial inspection", `${base}/condition`, "Dated condition report"],
    ["Custody", `${base}/custody`, "Record that Katha holds the work"],
    ["Media", `${base}/media`, "Approved public hero image"],
    ["Minting", `${base}/minting`, "Unique asset bound to the record"],
    ["Publication", `${base}/minting`, "A separate, explicit step after minting"],
  ] as const;
  const done = workflow
    ? [
        workflow.steps.documentation === "COMPLETE",
        workflow.steps.registration === "COMPLETE",
        workflow.steps.verification === "COMPLETE",
        workflow.steps.condition === "COMPLETE",
        workflow.steps.custody === "COMPLETE",
        workflow.steps.media === "COMPLETE",
        workflow.minted,
        workflow.published,
      ]
    : null;
  return (
    <section className="panel cut-s" aria-labelledby="publication-path-title">
      <h2 id="publication-path-title" className="h3">
        Path to publication
      </h2>
      <ol className="wf mt-2.5">
        {steps.map(([label, href, detail], index) => (
          <li key={label}>
            <span
              className={`wfn cut-s${done?.[index] ? " d" : ""}`}
              aria-hidden="true"
            >
              {done?.[index] ? "✓" : index + 1}
            </span>
            <div>
              <Link
                className="lnk sm"
                href={href}
                aria-label={
                  done ? `${label}${done[index] ? ", done" : ", to do"}` : undefined
                }
              >
                {label}
              </Link>
              <p className="xs mut m-0">{detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="xs mut mt-2.5 mb-0">
        Each workflow page checks its own prerequisites before anything is prepared.
      </p>
    </section>
  );
}
