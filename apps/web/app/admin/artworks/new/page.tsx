import Link from "next/link";
import type { Metadata } from "next";
import { ArtworkCreatePanel } from "../../../../components/artwork-draft-editor";
export const metadata: Metadata = {
  title: "Create artwork — Katha operations",
  robots: { index: false, follow: false },
};
export default function NewArtworkPage() {
  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link className="lnk" href="/admin/artworks">
          Artworks
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">New artwork</span>
      </nav>
      <h1 className="h1 h1-ops mt-3 mb-2.5">Create artwork</h1>
      <ArtworkCreatePanel />
    </>
  );
}
