"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const workflowSections = [
  { slug: "", tab: "Documentation", title: "Artwork documentation" },
  { slug: "registration", tab: "Registration", title: "Registration" },
  { slug: "verification", tab: "Verification", title: "Authenticity verification" },
  { slug: "condition", tab: "Condition", title: "Condition inspection" },
  { slug: "custody", tab: "Custody", title: "Custody and fulfillment" },
  { slug: "media", tab: "Media", title: "Media management" },
  { slug: "minting", tab: "Minting", title: "Minting and publication" },
  { slug: "metadata", tab: "Metadata", title: "Metadata revisions" },
] as const;

// Per-workflow completion needs several protected reads, so tabs mark only the
// current page; each page states its own status from its own response.
export function ArtworkWorkflowNav({ kathaId }: { kathaId: string }) {
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
        {workflowSections.map((section) => (
          <Link
            key={section.tab}
            href={section.slug ? `${base}/${section.slug}` : base}
            aria-current={section === current ? "page" : undefined}
          >
            <span className="dm" aria-hidden="true" />
            {section.tab}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function PublicationPath({ kathaId }: { kathaId: string }) {
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
  return (
    <section className="panel cut-s" aria-labelledby="publication-path-title">
      <h2 id="publication-path-title" className="h3">
        Path to publication
      </h2>
      <ol className="wf mt-2.5">
        {steps.map(([label, href, detail], index) => (
          <li key={label}>
            <span className="wfn cut-s" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <Link className="lnk sm" href={href}>
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
